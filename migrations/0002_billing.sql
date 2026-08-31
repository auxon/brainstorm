-- Archive subscription (Stripe) + 1Sat Ordinal NFT mints.

ALTER TABLE wallet_users ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE wallet_users ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE wallet_users ADD COLUMN stripe_status TEXT;

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
