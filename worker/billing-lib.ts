/** Archive subscription is $9/mo and unlocks minting a session as a 1Sat Ordinal. */
export const ARCHIVE_AMOUNT_USD = 9;
export const ARCHIVE_INTERVAL = "month";
export const FEATURE_AMOUNT_USD = 29;
export const FEATURE_DAYS = 7;
export const BOOST_OPTIONS = [
  { usd: 1, label: "$1" },
  { usd: 3, label: "$3" },
  { usd: 5, label: "$5" },
] as const;
export const NFT_CONTENT_TYPE = "text/markdown";
export const NFT_MAX_BYTES = 350_000;

const ACTIVE = new Set(["active", "trialing", "past_due"]);

export function isArchiveActive(status: string | null | undefined): boolean {
  return Boolean(status && ACTIVE.has(status));
}

export function featureWindowMs(days = FEATURE_DAYS): number {
  return days * 24 * 60 * 60 * 1000;
}

export function nftOriginFromTxid(txid: string, vout = 0): string {
  const clean = txid.trim().toLowerCase();
  return `${clean}_${vout}`;
}

export function integrationIdentifier(prefix = "brainstorm_archive"): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  let suffix = "";
  for (const b of buf) suffix += alphabet[b % alphabet.length];
  return `${prefix}_${suffix}`;
}

export type CheckoutKind = "archive" | "feature" | "boost" | "ignore";

export function checkoutKind(session: {
  mode?: string | null;
  subscription?: unknown;
  metadata?: Record<string, string> | null;
}): CheckoutKind {
  const kind = session.metadata?.kind;
  if (kind === "feature") return "feature";
  if (kind === "boost") return "boost";
  if (session.mode === "subscription" || session.subscription) return "archive";
  return "ignore";
}

export type BillingEnv = Env & {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;
  STRIPE_PUBLISHABLE_KEY?: string;
  /** WIF for the site treasury that inscribes Archive NFTs. Never log this. */
  SITE_WALLET_WIF?: string;
};

export function billingConfigured(env: BillingEnv): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID);
}

export function stripePaymentsReady(env: BillingEnv): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}
