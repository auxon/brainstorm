-- Wallet identity (Yours BRC-100, same pattern as SatPress) + brainstorm graph.

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
  visibility TEXT NOT NULL DEFAULT 'unlisted'
    CHECK (visibility IN ('unlisted', 'public', 'token')),
  view_token TEXT NOT NULL,
  edit_token TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES wallet_users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES ideas(id) ON DELETE SET NULL,
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
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ideas_session ON ideas (session_id, sort_index);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  author_user_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_address TEXT,
  vote_count INTEGER NOT NULL DEFAULT 0,
  satoshis INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_idea ON comments (idea_id, created_at);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  label TEXT,
  UNIQUE (session_id, source_id, target_id)
);
CREATE INDEX IF NOT EXISTS idx_edges_session ON edges (session_id);

CREATE TABLE IF NOT EXISTS votes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('idea', 'comment')),
  target_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES wallet_users(id),
  satoshis INTEGER NOT NULL DEFAULT 0,
  txid TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_votes_target ON votes (target_type, target_id);
