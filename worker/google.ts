/**
 * Google OAuth (authorization code + PKCE) and encrypted Drive tokens.
 *
 * Scopes: OpenID profile/email + drive.file (only files this app creates).
 * Redirect: {origin}/brainstorm/api/auth/google/callback
 */
import { APP_PREFIX } from "./paths";
import { buildSessionCookie, isGuestId, mintSessionForUser, requestIsSecure } from "./auth";
import { transferBilling } from "./billing";
import { GOOGLE_USER_PREFIX, isGoogleUserId } from "./identity";
import { randomHex } from "./ids";
import { HttpError, type WalletUser } from "./types";

export { GOOGLE_USER_PREFIX, isGoogleUserId as isGoogleId };
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.file",
].join(" ");

const OAUTH_TTL_MS = 15 * 60 * 1000;
const OAUTH_COOKIE = "brainstorm_gstate";
const ACCESS_SKEW_MS = 60_000;

export function googleUserId(sub: string): string {
  const cleaned = sub.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  if (cleaned) return `${GOOGLE_USER_PREFIX}${cleaned}`;
  return `${GOOGLE_USER_PREFIX}${randomHex(16)}`;
}

export function googleConfigured(env: Env): boolean {
  return Boolean(googleClientId(env) && googleClientSecret(env));
}

export function googleClientId(env: Env): string {
  return (env.BS_GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID || "").trim();
}

export function googleClientSecret(env: Env): string {
  return (env.BS_GOOGLE_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET || "").trim();
}

function tokenSealKey(env: Env): string {
  const key = (env.BS_GOOGLE_TOKEN_KEY || env.GOOGLE_TOKEN_KEY || googleClientSecret(env)).trim();
  if (!key) throw new HttpError(503, "Google Drive is not configured");
  return key;
}

export function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  if (url.hostname === "entangleit.com") return "https://entangleit.com";
  const forwarded = request.headers.get("x-forwarded-proto");
  const proto = forwarded === "https" || url.protocol === "https:" ? "https" : "http";
  return `${proto}://${url.host}`;
}

export function googleCallbackUrl(request: Request): string {
  return `${publicOrigin(request)}${APP_PREFIX}/api/auth/google/callback`;
}

export function sanitizeReturnTo(raw: string | null | undefined, prefix = APP_PREFIX): string {
  const fallback = `${prefix}/`;
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return fallback;
  if (/[\r\n\\]/.test(trimmed) || trimmed.includes("://")) return fallback;
  const path = trimmed.startsWith(prefix) ? trimmed : `${prefix}${trimmed}`;
  if (path.startsWith("//")) return fallback;
  return path;
}

export function withGoogleFlag(path: string): string {
  return path.includes("?") ? `${path}&google=connected` : `${path}?google=connected`;
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Uint8Array {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealSecret(plain: string, secret: string): Promise<string> {
  const key = await aesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  const out = new Uint8Array(iv.length + new Uint8Array(ct).byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.length);
  return base64url(out);
}

export async function openSecret(sealed: string, secret: string): Promise<string> {
  const key = await aesKey(secret);
  const raw = fromBase64url(sealed);
  const iv = raw.slice(0, 12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, raw.slice(12));
  return new TextDecoder().decode(pt);
}

export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

export function googleAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export function buildOauthCookie(state: string, secure: boolean, path: string): string {
  const parts = [
    `${OAUTH_COOKIE}=${state}`,
    `Path=${path || "/"}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(OAUTH_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function buildClearOauthCookie(secure: boolean, path: string): string {
  const parts = [`${OAUTH_COOKIE}=`, `Path=${path || "/"}`, "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function readOauthCookie(request: Request): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) === OAUTH_COOKIE) return trimmed.slice(eq + 1) || null;
  }
  return null;
}

export function googleSetupHtml(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Google sign-in</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0b0f14;color:#e8eef5;margin:40px;line-height:1.5}
  a{color:#2ee6c8}
  code{background:#141b24;padding:2px 6px;border-radius:4px}
</style></head>
<body>
  <h1>Google sign-in is not configured</h1>
  <p>Add a Google Cloud OAuth web client, enable the Drive API, then set Worker secrets:</p>
  <p><code>npx wrangler secret put BS_GOOGLE_CLIENT_ID</code><br>
  <code>npx wrangler secret put GOOGLE_CLIENT_SECRET</code></p>
  <p>Authorized redirect URI:</p>
  <p><code>https://entangleit.com/brainstorm/api/auth/google/callback</code></p>
  <p><a href="${APP_PREFIX}/">Back to Brainstorm</a></p>
</body></html>`;
}

export function googleErrorHtml(message: string): string {
  const safe = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Google sign-in</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0b0f14;color:#e8eef5;margin:40px;line-height:1.5}
  a{color:#2ee6c8}
</style></head>
<body>
  <h1>Could not sign in with Google</h1>
  <p>${safe}</p>
  <p><a href="${APP_PREFIX}/login">Try again</a> · <a href="${APP_PREFIX}/">Home</a></p>
</body></html>`;
}

export async function startGoogleOAuth(
  env: Env,
  request: Request,
  currentUser: WalletUser | null,
): Promise<Response> {
  if (!googleConfigured(env)) {
    return new Response(googleSetupHtml(), { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
  }
  const url = new URL(request.url);
  const returnTo = sanitizeReturnTo(url.searchParams.get("return"));
  const { verifier, challenge } = await pkcePair();
  const state = randomHex(16);
  const t = Date.now();
  await env.DB.prepare("DELETE FROM google_oauth_states WHERE expires_at < ?").bind(t).run();
  await env.DB.prepare(
    "INSERT INTO google_oauth_states (state, code_verifier, return_to, guest_user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(state, verifier, returnTo, currentUser?.id ?? null, t, t + OAUTH_TTL_MS)
    .run();
  const location = googleAuthorizeUrl({
    clientId: googleClientId(env),
    redirectUri: googleCallbackUrl(request),
    state,
    challenge,
  });
  const headers = new Headers({ location, "cache-control": "no-store" });
  headers.append("set-cookie", buildOauthCookie(state, requestIsSecure(request), APP_PREFIX));
  return new Response(null, { status: 302, headers });
}

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleUserInfo = {
  sub?: string;
  email?: string;
  name?: string;
  picture?: string;
};

async function exchangeCode(
  env: Env,
  request: Request,
  code: string,
  verifier: string,
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: googleClientId(env),
    client_secret: googleClientSecret(env),
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: googleCallbackUrl(request),
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  return (await res.json()) as GoogleTokenResponse;
}

async function fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new HttpError(401, "Could not read the Google profile");
  return (await res.json()) as GoogleUserInfo;
}

async function transferGuestRecords(db: D1Database, fromUserId: string | null, toUserId: string): Promise<void> {
  if (!fromUserId || fromUserId === toUserId || !isGuestId(fromUserId)) return;
  await transferBilling(db, fromUserId, toUserId);
  await db.prepare("UPDATE sessions SET owner_user_id = ? WHERE owner_user_id = ?").bind(toUserId, fromUserId).run();
}

export async function upsertGoogleAccount(
  env: Env,
  input: {
    userId: string;
    sub: string;
    email?: string | null;
    picture?: string | null;
    accessToken: string;
    refreshToken?: string | null;
    expiresIn?: number;
    folderId?: string | null;
  },
): Promise<void> {
  const t = Date.now();
  const key = tokenSealKey(env);
  const accessEnc = await sealSecret(input.accessToken, key);
  const refreshEnc = input.refreshToken ? await sealSecret(input.refreshToken, key) : null;
  const expires = t + Math.max(60, input.expiresIn ?? 3600) * 1000;
  const existing = await env.DB.prepare("SELECT user_id, refresh_token_enc, drive_folder_id FROM google_accounts WHERE user_id = ? OR google_sub = ?")
    .bind(input.userId, input.sub)
    .first<{ user_id: string; refresh_token_enc: string | null; drive_folder_id: string | null }>();
  if (existing) {
    await env.DB.prepare(
      "UPDATE google_accounts SET user_id = ?, google_sub = ?, email = ?, picture = ?, refresh_token_enc = COALESCE(?, refresh_token_enc), access_token_enc = ?, access_expires_at = ?, drive_folder_id = COALESCE(?, drive_folder_id), updated_at = ? WHERE user_id = ? OR google_sub = ?",
    )
      .bind(
        input.userId,
        input.sub,
        input.email ?? null,
        input.picture ?? null,
        refreshEnc,
        accessEnc,
        expires,
        input.folderId ?? null,
        t,
        existing.user_id,
        input.sub,
      )
      .run();
    return;
  }
  await env.DB.prepare(
    "INSERT INTO google_accounts (user_id, google_sub, email, picture, refresh_token_enc, access_token_enc, access_expires_at, drive_folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      input.userId,
      input.sub,
      input.email ?? null,
      input.picture ?? null,
      refreshEnc,
      accessEnc,
      expires,
      input.folderId ?? null,
      t,
      t,
    )
    .run();
}

export async function handleGoogleCallback(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const err = url.searchParams.get("error");
  const secure = requestIsSecure(request);
  const clear = buildClearOauthCookie(secure, APP_PREFIX);
  if (err) {
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    headers.append("set-cookie", clear);
    return new Response(googleErrorHtml(err === "access_denied" ? "Google sign-in was cancelled." : err), {
      status: 400,
      headers,
    });
  }
  if (!googleConfigured(env)) {
    return new Response(googleSetupHtml(), { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return new Response(googleErrorHtml("Missing authorization code."), {
      status: 400,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  const cookieState = readOauthCookie(request);
  if (!cookieState || cookieState !== state) {
    return new Response(googleErrorHtml("Sign-in expired. Try Google again."), {
      status: 400,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  const row = await env.DB.prepare(
    "SELECT code_verifier, return_to, guest_user_id, expires_at FROM google_oauth_states WHERE state = ?",
  )
    .bind(state)
    .first<{ code_verifier: string; return_to: string; guest_user_id: string | null; expires_at: number }>();
  await env.DB.prepare("DELETE FROM google_oauth_states WHERE state = ?").bind(state).run();
  if (!row || row.expires_at < Date.now()) {
    return new Response(googleErrorHtml("Sign-in expired. Try Google again."), {
      status: 400,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const tokens = await exchangeCode(env, request, code, row.code_verifier);
  if (!tokens.access_token) {
    return new Response(googleErrorHtml(tokens.error_description || tokens.error || "Google did not return a token."), {
      status: 400,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  const profile = await fetchUserInfo(tokens.access_token);
  if (!profile.sub) {
    return new Response(googleErrorHtml("Google profile was missing an id."), {
      status: 400,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const linked = await env.DB.prepare("SELECT user_id FROM google_accounts WHERE google_sub = ?")
    .bind(profile.sub)
    .first<{ user_id: string }>();
  const previous = row.guest_user_id;
  let userId: string;
  if (linked) {
    userId = linked.user_id;
  } else if (previous && !isGuestId(previous) && !isGoogleUserId(previous)) {
    userId = previous;
  } else {
    userId = googleUserId(profile.sub);
  }

  const { token, user } = await mintSessionForUser(env.DB, {
    userId,
    handle: profile.email ?? null,
    displayName: profile.name ?? profile.email ?? "Google",
    email: profile.email ?? null,
    picture: profile.picture ?? null,
  });
  await upsertGoogleAccount(env, {
    userId: user.id,
    sub: profile.sub,
    email: profile.email ?? null,
    picture: profile.picture ?? null,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresIn: tokens.expires_in,
  });
  await transferGuestRecords(env.DB, previous, user.id);

  const headers = new Headers({
    location: `${publicOrigin(request)}${withGoogleFlag(row.return_to)}`,
    "cache-control": "no-store",
  });
  headers.append("set-cookie", buildSessionCookie(token, secure, APP_PREFIX));
  headers.append("set-cookie", clear);
  return new Response(null, { status: 302, headers });
}

export type GoogleAccountRow = {
  user_id: string;
  google_sub: string;
  email: string | null;
  picture: string | null;
  refresh_token_enc: string | null;
  access_token_enc: string | null;
  access_expires_at: number | null;
  drive_folder_id: string | null;
};

export async function loadGoogleAccount(db: D1Database, userId: string): Promise<GoogleAccountRow | null> {
  return db
    .prepare(
      "SELECT user_id, google_sub, email, picture, refresh_token_enc, access_token_enc, access_expires_at, drive_folder_id FROM google_accounts WHERE user_id = ?",
    )
    .bind(userId)
    .first<GoogleAccountRow>();
}

export async function getValidAccessToken(env: Env, userId: string): Promise<string> {
  const row = await loadGoogleAccount(env.DB, userId);
  if (!row) throw new HttpError(401, "Sign in with Google to use Drive");
  const key = tokenSealKey(env);
  if (row.access_token_enc && (row.access_expires_at ?? 0) > Date.now() + ACCESS_SKEW_MS) {
    return openSecret(row.access_token_enc, key);
  }
  if (!row.refresh_token_enc) throw new HttpError(401, "Reconnect Google to refresh Drive access");
  const refresh = await openSecret(row.refresh_token_enc, key);
  const body = new URLSearchParams({
    client_id: googleClientId(env),
    client_secret: googleClientSecret(env),
    refresh_token: refresh,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokens = (await res.json()) as GoogleTokenResponse;
  if (!tokens.access_token) {
    throw new HttpError(401, tokens.error_description || "Reconnect Google to use Drive");
  }
  await upsertGoogleAccount(env, {
    userId,
    sub: row.google_sub,
    email: row.email,
    picture: row.picture,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? refresh,
    expiresIn: tokens.expires_in,
    folderId: row.drive_folder_id,
  });
  return tokens.access_token;
}

export async function saveDriveFolderId(db: D1Database, userId: string, folderId: string): Promise<void> {
  await db
    .prepare("UPDATE google_accounts SET drive_folder_id = ?, updated_at = ? WHERE user_id = ?")
    .bind(folderId, Date.now(), userId)
    .run();
}

export async function googleStatus(env: Env, user: WalletUser | null): Promise<{
  configured: boolean;
  connected: boolean;
  email: string | null;
  name: string | null;
  picture: string | null;
  startPath: string;
}> {
  const configured = googleConfigured(env);
  const account = user ? await loadGoogleAccount(env.DB, user.id) : null;
  return {
    configured,
    connected: Boolean(account),
    email: account?.email ?? user?.email ?? null,
    name: user?.displayName ?? null,
    picture: account?.picture ?? user?.picture ?? null,
    startPath: `${APP_PREFIX}/api/auth/google/start`,
  };
}

export async function disconnectGoogle(env: Env, userId: string): Promise<void> {
  const row = await loadGoogleAccount(env.DB, userId);
  if (!row) return;
  try {
    const key = tokenSealKey(env);
    const token = row.refresh_token_enc
      ? await openSecret(row.refresh_token_enc, key)
      : row.access_token_enc
        ? await openSecret(row.access_token_enc, key)
        : null;
    if (token) {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      });
    }
  } catch {
    /* revoke is best-effort */
  }
  await env.DB.prepare("DELETE FROM google_accounts WHERE user_id = ?").bind(userId).run();
}
