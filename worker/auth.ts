/**
 * Yours BRC-100 wallet authentication — Worker side.
 *
 * Same flow as auxon/SatPress:
 *   1. Client asks for a challenge (nonce + origin-bound message).
 *   2. Yours Wallet signs it with `signBsm` and a derivation tag that always
 *      yields the same pubkey for this app.
 *   3. We verify the Bitcoin Signed Message with `@bsv/sdk`, burn the nonce,
 *      and mint an opaque session (httpOnly cookie + body token).
 *
 * Identity = compressed signing pubkey hex. Proving the private key IS login.
 */
import { BSM, PublicKey, Signature, Utils } from "@bsv/sdk";
import { HttpError, type WalletUser } from "./types";
import { randomHex, sha256Hex } from "./ids";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
/** Must match the tag the client passes to signBsm. */
export const SIGN_TAG = { label: "brainstorm", id: "login", domain: "entangleit.com" };

const COOKIE = "brainstorm_session";

export function requestIsSecure(request: Request): boolean {
  if (new URL(request.url).protocol === "https:") return true;
  return request.headers.get("x-forwarded-proto") === "https";
}

export function buildSessionCookie(token: string, secure: boolean, path: string): string {
  const parts = [
    `${COOKIE}=${token}`,
    `Path=${path || "/"}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function buildClearCookie(secure: boolean, path: string): string {
  const parts = [`${COOKIE}=`, `Path=${path || "/"}`, "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function assertSameOriginPost(request: Request): void {
  const site = request.headers.get("sec-fetch-site");
  if (!site || site === "same-origin" || site === "none") return;
  throw new HttpError(403, "cross-site request blocked");
}

export async function issueChallenge(db: D1Database, origin: string): Promise<{ nonce: string; message: string }> {
  const t = Date.now();
  await db.prepare("DELETE FROM wallet_challenges WHERE expires_at < ?").bind(t).run();
  const nonce = randomHex(16);
  const message = [
    "Brainstorm sign-in",
    `Origin: ${origin}`,
    `Nonce: ${nonce}`,
    `Time: ${new Date(t).toISOString()}`,
  ].join("\n");
  await db
    .prepare(
      "INSERT INTO wallet_challenges (nonce, message, origin, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(nonce, message, origin, t, t + CHALLENGE_TTL_MS)
    .run();
  return { nonce, message };
}

export async function mintSessionForUser(
  db: D1Database,
  input: {
    userId: string;
    identityKey?: string | null;
    address?: string | null;
    handle?: string | null;
    displayName?: string | null;
  },
): Promise<{ token: string; user: WalletUser }> {
  const t = Date.now();
  const existing = await db
    .prepare("SELECT id FROM wallet_users WHERE id = ?")
    .bind(input.userId)
    .first<{ id: string }>();
  if (existing) {
    await db
      .prepare(
        "UPDATE wallet_users SET last_login_at = ?, identity_key = COALESCE(?, identity_key), address = COALESCE(?, address), handle = COALESCE(?, handle), display_name = COALESCE(?, display_name) WHERE id = ?",
      )
      .bind(
        t,
        input.identityKey ?? null,
        input.address ?? null,
        input.handle ?? null,
        input.displayName ?? null,
        input.userId,
      )
      .run();
  } else {
    await db
      .prepare(
        "INSERT INTO wallet_users (id, identity_key, address, handle, display_name, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        input.userId,
        input.identityKey ?? null,
        input.address ?? null,
        input.handle ?? null,
        input.displayName ?? null,
        t,
        t,
      )
      .run();
  }

  const token = randomHex(32);
  await db
    .prepare("INSERT INTO wallet_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(token), input.userId, t, t + SESSION_TTL_MS)
    .run();

  return {
    token,
    user: {
      id: input.userId,
      identityKey: input.identityKey ?? null,
      address: input.address ?? null,
      handle: input.handle ?? null,
      displayName: input.displayName ?? null,
    },
  };
}

export async function verifyChallenge(
  db: D1Database,
  input: {
    nonce: string;
    message: string;
    sig: string;
    pubKey: string;
    identityKey?: string | null;
    address?: string | null;
  },
): Promise<{ token: string; user: WalletUser }> {
  const t = Date.now();
  const challenge = await db
    .prepare("SELECT message, origin, expires_at FROM wallet_challenges WHERE nonce = ?")
    .bind(input.nonce)
    .first<{ message: string; origin: string; expires_at: number }>();
  await db.prepare("DELETE FROM wallet_challenges WHERE nonce = ?").bind(input.nonce).run();
  if (!challenge) throw new HttpError(400, "Unknown or already-used sign-in challenge");
  if (challenge.expires_at < t) throw new HttpError(400, "Sign-in challenge expired — try again");
  if (challenge.message !== input.message) {
    throw new HttpError(400, "Signed message does not match the challenge");
  }

  let valid = false;
  try {
    const messageBytes = Array.from(new TextEncoder().encode(challenge.message));
    const signature = Signature.fromCompact(Utils.toArray(input.sig, "base64"));
    const pubKey = PublicKey.fromString(input.pubKey);
    valid = BSM.verify(messageBytes, signature, pubKey);
  } catch {
    valid = false;
  }
  if (!valid) throw new HttpError(401, "Wallet signature verification failed");

  return mintSessionForUser(db, {
    userId: input.pubKey.trim().toLowerCase(),
    identityKey: input.identityKey ?? null,
    address: input.address ?? null,
  });
}

function readSessionToken(request: Request): string | null {
  const bearer = request.headers.get("authorization");
  if (bearer?.toLowerCase().startsWith("bearer ")) {
    return bearer.slice(7).trim() || null;
  }
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) === COOKIE) return trimmed.slice(eq + 1) || null;
  }
  return null;
}

export async function getSessionUser(request: Request, db: D1Database): Promise<WalletUser | null> {
  const token = readSessionToken(request);
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await db
    .prepare(
      "SELECT u.id, u.identity_key, u.address, u.handle, u.display_name, s.expires_at FROM wallet_sessions s JOIN wallet_users u ON u.id = s.user_id WHERE s.token_hash = ?",
    )
    .bind(hash)
    .first<{
      id: string;
      identity_key: string | null;
      address: string | null;
      handle: string | null;
      display_name: string | null;
      expires_at: number;
    }>();
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await db.prepare("DELETE FROM wallet_sessions WHERE token_hash = ?").bind(hash).run();
    return null;
  }
  return {
    id: row.id,
    identityKey: row.identity_key,
    address: row.address,
    handle: row.handle,
    displayName: row.display_name,
  };
}

export async function revokeSession(request: Request, db: D1Database): Promise<void> {
  const token = readSessionToken(request);
  if (!token) return;
  await db.prepare("DELETE FROM wallet_sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
}

export async function purgeExpired(db: D1Database): Promise<void> {
  const t = Date.now();
  await db.prepare("DELETE FROM wallet_sessions WHERE expires_at < ?").bind(t).run();
  await db.prepare("DELETE FROM wallet_challenges WHERE expires_at < ?").bind(t).run();
}

export function displayNameFor(user: WalletUser): string {
  return user.displayName || user.handle || shortKey(user.id);
}

export function shortKey(hex: string, head = 6, tail = 4): string {
  if (hex.length <= head + tail + 1) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}
