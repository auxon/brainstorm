/** Optional Google OAuth bindings. Prefer BS_ secrets — GOOGLE_CLIENT_ID is a reserved var name. */
interface Env {
  BS_GOOGLE_CLIENT_ID?: string;
  BS_GOOGLE_CLIENT_SECRET?: string;
  BS_GOOGLE_TOKEN_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_TOKEN_KEY?: string;
}
