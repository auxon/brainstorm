-- Google sign-in + Drive backups of brainstorm sessions.

ALTER TABLE wallet_users ADD COLUMN email TEXT;
ALTER TABLE wallet_users ADD COLUMN picture TEXT;

CREATE TABLE IF NOT EXISTS google_accounts (
  user_id TEXT PRIMARY KEY REFERENCES wallet_users(id),
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT,
  picture TEXT,
  refresh_token_enc TEXT,
  access_token_enc TEXT,
  access_expires_at INTEGER,
  drive_folder_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS google_accounts_sub_idx ON google_accounts (google_sub);

CREATE TABLE IF NOT EXISTS google_oauth_states (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  return_to TEXT NOT NULL,
  guest_user_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS drive_files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES wallet_users(id),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  drive_file_id TEXT NOT NULL,
  title TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, session_id),
  UNIQUE (user_id, drive_file_id)
);
CREATE INDEX IF NOT EXISTS drive_files_user_idx ON drive_files (user_id, updated_at);
