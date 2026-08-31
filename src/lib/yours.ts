/**
 * Yours Wallet client over the BRC-100 provider API (@1sat/actions).
 * Pattern matches auxon/SatPress `src/lib/ord/yours.ts`.
 */
import {
  createContext,
  deriveDepositAddresses,
  sendBsv,
  type OneSatContext,
} from "@1sat/actions";
import { OneSatServices } from "@1sat/client";

export const YOURS_CHROME =
  "https://chromewebstore.google.com/detail/yours-wallet/mlbnicldlpdimbjdcncnklfempedeipj";
export const YOURS_SITE = "https://yours.org";

export type YoursAddresses = {
  bsvAddress: string;
  ordAddress: string;
  identityAddress?: string;
};

export type YoursBalance = { bsv: number; satoshis: number };

export type YoursSession = {
  provider: "yours";
  addresses: YoursAddresses;
  balance: YoursBalance | null;
  identity?: string;
};

let activeCtx: OneSatContext | null = null;

export function setActiveContext(ctx: OneSatContext | null): void {
  activeCtx = ctx;
}

export function getActiveContext(): OneSatContext | null {
  return activeCtx;
}

export function requireContext(): OneSatContext {
  if (!activeCtx) throw new Error("Connect Yours Wallet first.");
  return activeCtx;
}

const services = new OneSatServices("main");

export function buildContext(wallet: NonNullable<OneSatContext["wallet"]>): OneSatContext {
  return createContext(wallet, { chain: "main", services, isBaseWallet: false });
}

export async function buildSession(identityKey: string): Promise<YoursSession> {
  const ctx = requireContext();
  const derivations = await deriveDepositAddresses.execute(ctx, { startIndex: 0, count: 2 });
  const bsvAddress = derivations.derivations[0]?.address ?? "";
  const ordAddress = derivations.derivations[1]?.address ?? bsvAddress;
  if (!bsvAddress) {
    throw new Error("Yours Wallet did not return a deposit address. Unlock the extension and try again.");
  }
  let balance: YoursBalance | null = null;
  try {
    const outputs = await ctx.wallet.listOutputs({ basket: "default", limit: 500 });
    const sats = outputs.outputs.reduce((sum, o) => sum + (o.spendable ? o.satoshis : 0), 0);
    balance = { satoshis: sats, bsv: sats / 1e8 };
  } catch {
    balance = null;
  }
  return {
    provider: "yours",
    addresses: { bsvAddress, ordAddress, identityAddress: identityKey },
    balance,
    identity: identityKey,
  };
}

export async function sendBsvWithYours(payments: { address: string; satoshis: number }[]): Promise<string> {
  if (!payments.length) throw new Error("Nothing to send.");
  const ctx = requireContext();
  const result = await sendBsv.execute(ctx, {
    requests: payments.map((p) => ({ address: p.address, satoshis: p.satoshis })),
  });
  if (!result.txid) throw wrapWalletError(new Error(result.error ?? "no-txid"), "Payment");
  return result.txid;
}

export function wrapWalletError(err: unknown, verb: string): Error {
  const raw = err instanceof Error ? err.message : String(err ?? "Unknown error");
  const lower = raw.toLowerCase();
  if (
    lower.includes("user-rejected") ||
    lower.includes("reject") ||
    lower.includes("denied") ||
    lower.includes("cancel")
  ) {
    return new Error(`${verb} was rejected in Yours Wallet.`);
  }
  if (lower.includes("insufficient")) {
    return new Error("Yours Wallet does not have enough BSV for this upvote.");
  }
  if (lower.includes("not-connected") || lower.includes("connect") || lower.includes("locked")) {
    return new Error("Unlock Yours Wallet and connect it to Brainstorm.");
  }
  return new Error(raw || `${verb} failed in Yours Wallet.`);
}
