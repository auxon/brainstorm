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
};

export type NftPrepare = {
  markdown: string;
  contentHash: string;
  contentType: string;
  bytes: number;
  map: Record<string, string>;
};
