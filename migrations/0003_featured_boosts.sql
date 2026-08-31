-- Featured gallery slots + USD boosts on ideas/comments/votes.

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

ALTER TABLE ideas ADD COLUMN usd_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE comments ADD COLUMN usd_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE votes ADD COLUMN usd_cents INTEGER NOT NULL DEFAULT 0;
