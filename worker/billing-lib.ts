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
  return Boolean(env.STRIPE_SECRET_KEY);
}

export function stripePaymentsReady(env: BillingEnv): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

/** Live vs test from the key prefix. Sandbox keys (`rkcs_test_`) are test. */
export function stripeKeyLivemode(key: string | null | undefined): boolean | null {
  if (!key) return null;
  if (key.includes("_live_")) return true;
  if (key.includes("_test_")) return false;
  return null;
}

export function stripeEnvLivemode(env: BillingEnv): boolean | null {
  return stripeKeyLivemode(env.STRIPE_SECRET_KEY) ?? stripeKeyLivemode(env.STRIPE_PUBLISHABLE_KEY);
}

/** Test-mode (or other-account) customer ids fail live Checkout with resource_missing. */
export function isStripeMissingResource(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  if (e.code === "resource_missing") return true;
  return typeof e.message === "string" && /no such (customer|price|subscription)/i.test(e.message);
}

export function stripeErrorMessage(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { type?: string; rawType?: string; message?: string };
  if (typeof e.message === "string" && (e.type || e.rawType || isStripeMissingResource(err))) {
    return e.message;
  }
  return null;
}

/**
 * Archive line items. Live keys cannot use a test-mode catalog price, so live
 * (and any env without STRIPE_PRICE_ID) uses ad-hoc `price_data`.
 */
export function archiveLineItems(
  priceId: string | undefined,
  livemode: boolean | null,
): Array<{ price: string; quantity: number } | { quantity: number; price_data: Record<string, unknown> }> {
  if (priceId && livemode !== true) {
    return [{ price: priceId, quantity: 1 }];
  }
  return [
    {
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: ARCHIVE_AMOUNT_USD * 100,
        recurring: { interval: ARCHIVE_INTERVAL },
        product_data: {
          name: "Brainstorm Archive",
          description: "Mint brainstorm sessions as 1Sat Ordinal NFTs via the site wallet",
        },
      },
    },
  ];
}

/** Production hostname must not charge in Stripe test mode. */
export function productionRequiresLiveStripe(hostname: string, livemode: boolean | null): boolean {
  return hostname === "entangleit.com" && livemode !== true;
}
