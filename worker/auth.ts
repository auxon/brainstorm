/**
 * Session authentication — Worker side.
 *
 * Humans do not need Yours Wallet. The first write mints a guest user
 * (`g_…`) and an opaque session cookie. Yours remains optional: a BSM
 * challenge (same flow as auxon/SatPress) upgrades that cookie to a BSV
 * identity for sat boosts. The site wallet (Worker WIF) is what inscribes NFTs.
 *
 * Wallet identity = compressed signing pubkey hex. Guest identity = `g_` + id.
 */
import { BSM, PublicKey, Signature, Utils } from "@bsv/sdk";
import { HttpError, type WalletUser } from "./types";
import { nanoid, randomHex, sha256Hex } from "./ids";
import { APP_PREFIX } from "./paths";

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
    email?: string | null;
    picture?: string | null;
    googleConnected?: boolean;
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
        "UPDATE wallet_users SET last_login_at = ?, identity_key = COALESCE(?, identity_key), address = COALESCE(?, address), handle = COALESCE(?, handle), display_name = COALESCE(?, display_name), email = COALESCE(?, email), picture = COALESCE(?, picture) WHERE id = ?",
      )
      .bind(
        t,
        input.identityKey ?? null,
        input.address ?? null,
        input.handle ?? null,
        input.displayName ?? null,
        input.email ?? null,
        input.picture ?? null,
        input.userId,
      )
      .run();
  } else {
    await db
      .prepare(
        "INSERT INTO wallet_users (id, identity_key, address, handle, display_name, email, picture, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        input.userId,
        input.identityKey ?? null,
        input.address ?? null,
        input.handle ?? null,
        input.displayName ?? null,
        input.email ?? null,
        input.picture ?? null,
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
    user: toWalletUser({
      id: input.userId,
      identity_key: input.identityKey ?? null,
      address: input.address ?? null,
      handle: input.handle ?? null,
      display_name: input.displayName ?? null,
      email: input.email ?? null,
      picture: input.picture ?? null,
      google_sub: input.googleConnected ? "1" : null,
    }),
  };
}

export const GUEST_PREFIX = "g_";

export function isGuestId(id: string): boolean {
  return id.startsWith(GUEST_PREFIX);
}

function toWalletUser(row: {
  id: string;
  identity_key?: string | null;
  address?: string | null;
  handle?: string | null;
  display_name?: string | null;
  email?: string | null;
  picture?: string | null;
  google_email?: string | null;
  google_picture?: string | null;
  google_sub?: string | null;
}): WalletUser {
  return {
    id: row.id,
    identityKey: row.identity_key ?? null,
    address: row.address ?? null,
    handle: row.handle ?? null,
    displayName: row.display_name ?? null,
    email: row.email ?? row.google_email ?? null,
    picture: row.picture ?? row.google_picture ?? null,
    isGuest: isGuestId(row.id),
    googleConnected: Boolean(row.google_sub),
  };
}

/** Mint a browser/MCP identity that does not require Yours Wallet. */
export async function mintGuestUser(
  db: D1Database,
  displayName = "Guest",
): Promise<{ token: string; user: WalletUser }> {
  return mintSessionForUser(db, {
    userId: `${GUEST_PREFIX}${nanoid(16)}`,
    displayName,
  });
}

export async function ensureSessionUser(
  db: D1Database,
  existing: WalletUser | null,
): Promise<{ user: WalletUser; mintedToken: string | null }> {
  if (existing) return { user: existing, mintedToken: null };
  const minted = await mintGuestUser(db);
  return { user: minted.user, mintedToken: minted.token };
}

export function attachSessionCookie(
  header: (name: string, value: string) => void,
  request: Request,
  token: string,
): void {
  header("set-cookie", buildSessionCookie(token, requestIsSecure(request), APP_PREFIX));
  header("cache-control", "no-store");
  header("x-session-token", token);
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
      "SELECT u.id, u.identity_key, u.address, u.handle, u.display_name, u.email, u.picture, s.expires_at, g.google_sub, g.email as google_email, g.picture as google_picture FROM wallet_sessions s JOIN wallet_users u ON u.id = s.user_id LEFT JOIN google_accounts g ON g.user_id = u.id WHERE s.token_hash = ?",
    )
    .bind(hash)
    .first<{
      id: string;
      identity_key: string | null;
      address: string | null;
      handle: string | null;
      display_name: string | null;
      email: string | null;
      picture: string | null;
      google_sub: string | null;
      google_email: string | null;
      google_picture: string | null;
      expires_at: number;
    }>();
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await db.prepare("DELETE FROM wallet_sessions WHERE token_hash = ?").bind(hash).run();
    return null;
  }
  return toWalletUser(row);
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
  if (user.displayName) return user.displayName;
  if (user.handle) return user.handle;
  if (user.isGuest) return "Guest";
  return shortKey(user.id);
}

export function shortKey(hex: string, head = 6, tail = 4): string {
  if (hex.length <= head + tail + 1) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}
