const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS wallet_users (
  id TEXT PRIMARY KEY,
  identity_key TEXT,
  address TEXT,
  handle TEXT,
  display_name TEXT,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wallet_challenges (
  nonce TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  origin TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wallet_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES wallet_users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS wallet_sessions_user_idx ON wallet_sessions (user_id);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'unlisted',
  view_token TEXT NOT NULL,
  edit_token TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  parent_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  author_user_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_address TEXT,
  position_x REAL,
  position_y REAL,
  color TEXT,
  sort_index INTEGER NOT NULL DEFAULT 0,
  vote_count INTEGER NOT NULL DEFAULT 0,
  satoshis INTEGER NOT NULL DEFAULT 0,
  usd_cents INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ideas_session ON ideas (session_id, sort_index);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  idea_id TEXT NOT NULL,
  parent_id TEXT,
  body TEXT NOT NULL,
  author_user_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_address TEXT,
  vote_count INTEGER NOT NULL DEFAULT 0,
  satoshis INTEGER NOT NULL DEFAULT 0,
  usd_cents INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_idea ON comments (idea_id, created_at);
CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  label TEXT,
  UNIQUE (session_id, source_id, target_id)
);
CREATE INDEX IF NOT EXISTS idx_edges_session ON edges (session_id);
CREATE TABLE IF NOT EXISTS votes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  satoshis INTEGER NOT NULL DEFAULT 0,
  usd_cents INTEGER NOT NULL DEFAULT 0,
  txid TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_votes_target ON votes (target_type, target_id);
CREATE TABLE IF NOT EXISTS nfts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  txid TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  content_type TEXT NOT NULL,
  minted_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nfts_session ON nfts (session_id, created_at);
CREATE TABLE IF NOT EXISTS featured (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  paid_by TEXT NOT NULL,
  stripe_checkout_id TEXT,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_featured_ends ON featured (ends_at, starts_at);
CREATE TABLE IF NOT EXISTS stripe_payments (
  checkout_session_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  user_id TEXT,
  session_id TEXT,
  target_type TEXT,
  target_id TEXT,
  usd_cents INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`;

const BILLING_ALTERS = [
  "ALTER TABLE wallet_users ADD COLUMN stripe_customer_id TEXT",
  "ALTER TABLE wallet_users ADD COLUMN stripe_subscription_id TEXT",
  "ALTER TABLE wallet_users ADD COLUMN stripe_status TEXT",
  "ALTER TABLE ideas ADD COLUMN usd_cents INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE comments ADD COLUMN usd_cents INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE votes ADD COLUMN usd_cents INTEGER NOT NULL DEFAULT 0",
];

let ready = false;

/** Apply CREATE TABLE IF NOT EXISTS so local `vite dev` works before wrangler migrate. */
export async function ensureSchema(db: D1Database): Promise<void> {
  if (ready) return;
  const statements = SCHEMA_SQL.split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => db.prepare(s));
  await db.batch(statements);
  for (const sql of BILLING_ALTERS) {
    try {
      await db.prepare(sql).run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/duplicate column/i.test(message)) throw err;
    }
  }
  ready = true;
}
