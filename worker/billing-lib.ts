/** Archive subscription is $9/mo and unlocks minting a session as a 1Sat Ordinal. */
export const ARCHIVE_AMOUNT_USD = 9;
export const ARCHIVE_INTERVAL = "month";
export const NFT_CONTENT_TYPE = "text/markdown";
export const NFT_MAX_BYTES = 350_000;

const ACTIVE = new Set(["active", "trialing", "past_due"]);

export function isArchiveActive(status: string | null | undefined): boolean {
  return Boolean(status && ACTIVE.has(status));
}

export function nftOriginFromTxid(txid: string, vout = 0): string {
  const clean = txid.trim().toLowerCase();
  return `${clean}_${vout}`;
}

export function integrationIdentifier(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  let suffix = "";
  for (const b of buf) suffix += alphabet[b % alphabet.length];
  return `brainstorm_archive_${suffix}`;
}

export type BillingEnv = Env & {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;
  STRIPE_PUBLISHABLE_KEY?: string;
};

export function billingConfigured(env: BillingEnv): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID);
}
