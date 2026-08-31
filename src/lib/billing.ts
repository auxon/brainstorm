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
};
