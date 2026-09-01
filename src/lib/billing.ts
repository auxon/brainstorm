export const FEATURE_USD = 29;
export const FEATURE_DAYS = 7;
export const BOOST_USD = [1, 3, 5] as const;

export type BillingStatus = {
  configured: boolean;
  publishableKey: string | null;
  priceId: string | null;
  amountUsd: number;
  interval: string;
  product: string;
  status: string | null;
  active: boolean;
  hasCustomer: boolean;
  payments?: boolean;
  livemode?: boolean | null;
  featureUsd?: number;
  featureDays?: number;
  boosts?: number[];
  siteWallet?: {
    configured: boolean;
    address: string | null;
    satoshis: number | null;
    mintMode: "site" | "none";
  };
};

export type NftPrepare = {
  markdown: string;
  contentHash: string;
  contentType: string;
  bytes: number;
  map: Record<string, string>;
  feeSats?: number;
  neededSats?: number;
};

export function siteWalletShortfallMessage(opts: {
  address: string;
  haveSats: number;
  neededSats: number;
  feeSats?: number;
}): string {
  const shortfall = Math.max(0, opts.neededSats - opts.haveSats);
  const feeBit =
    opts.feeSats != null
      ? ` (${opts.feeSats.toLocaleString("en-US")} sat network fee + 1 sat ordinal)`
      : "";
  return (
    `Site wallet has ${opts.haveSats.toLocaleString("en-US")} sats but this inscription needs ` +
    `${opts.neededSats.toLocaleString("en-US")} sats${feeBit}. ` +
    `Send at least ${shortfall.toLocaleString("en-US")} more sats (${(shortfall / 1e8).toFixed(8)} BSV) to ${opts.address}.`
  );
}
