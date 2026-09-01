/**
 * Site treasury wallet — inscribes Archive NFTs on BSV as 1Sat Ordinals.
 *
 * End users never touch Yours for minting. The Worker holds SITE_WALLET_WIF
 * (Wrangler secret) and broadcasts. yours-agent is how the operator funds
 * this address; it is not on the hot path for humans.
 */
import { LockingScript, OP, P2PKH, PrivateKey, SatoshisPerKilobyte, Transaction, Utils } from "@bsv/sdk";
import { HttpError } from "./types";
import { nftOriginFromTxid, type BillingEnv } from "./billing-lib";

const WOC = "https://api.whatsonchain.com/v1/bsv/main";
/** ~0.05 sat/byte. BSV fees are tiny; this stays above dust for 350KB snapshots. */
const FEE_SAT_PER_KB = 50;
const SCRIPT_OVERHEAD_BYTES = 400;
const MIN_FEE_SATS = 200;
const ORDINAL_SATS = 1;
const CHANGE_BUFFER_SATS = 1;

export function estimateMintSats(contentBytes: number): {
  feeSats: number;
  ordinalSats: number;
  changeBufferSats: number;
  neededSats: number;
} {
  const feeSats = Math.max(
    MIN_FEE_SATS,
    Math.ceil((Math.max(0, contentBytes) + SCRIPT_OVERHEAD_BYTES) / 1000) * FEE_SAT_PER_KB,
  );
  return {
    feeSats,
    ordinalSats: ORDINAL_SATS,
    changeBufferSats: CHANGE_BUFFER_SATS,
    neededSats: ORDINAL_SATS + feeSats + CHANGE_BUFFER_SATS,
  };
}

export function satsToBsv(sats: number): string {
  return (Math.max(0, sats) / 1e8).toFixed(8);
}

export function siteWalletFundingMessage(opts: {
  address: string;
  haveSats: number;
  neededSats: number;
  feeSats: number;
}): string {
  const shortfall = Math.max(0, opts.neededSats - opts.haveSats);
  return (
    `Site wallet has ${opts.haveSats.toLocaleString("en-US")} sats but this inscription needs ` +
    `${opts.neededSats.toLocaleString("en-US")} sats (${opts.feeSats.toLocaleString("en-US")} sat network fee + 1 sat ordinal). ` +
    `Send at least ${shortfall.toLocaleString("en-US")} more sats (${satsToBsv(shortfall)} BSV) to ${opts.address}.`
  );
}

export type Utxo = { tx_hash: string; tx_pos: number; value: number };

export function siteWalletConfigured(env: BillingEnv): boolean {
  return Boolean(env.SITE_WALLET_WIF?.trim());
}

export function siteWalletAddress(env: BillingEnv): string | null {
  const wif = env.SITE_WALLET_WIF?.trim();
  if (!wif) return null;
  try {
    return PrivateKey.fromWif(wif).toAddress();
  } catch {
    return null;
  }
}

export function buildInscriptionLockingScript(
  address: string,
  content: Uint8Array,
  contentType: string,
): LockingScript {
  const script = new LockingScript();
  script.writeOpCode(OP.OP_FALSE);
  script.writeOpCode(OP.OP_IF);
  script.writeBin(Utils.toArray("ord", "utf8"));
  script.writeOpCode(OP.OP_1);
  script.writeBin(Utils.toArray(contentType, "utf8"));
  script.writeOpCode(OP.OP_0);
  script.writeBin(Array.from(content));
  script.writeOpCode(OP.OP_ENDIF);
  const p2pkh = new P2PKH().lock(address);
  for (const chunk of p2pkh.chunks) script.chunks.push(chunk);
  return new LockingScript(script.chunks);
}

export async function siteWalletStatus(env: BillingEnv): Promise<{
  configured: boolean;
  address: string | null;
  satoshis: number | null;
  mintMode: "site" | "none";
}> {
  const address = siteWalletAddress(env);
  if (!address) {
    return { configured: false, address: null, satoshis: null, mintMode: "none" };
  }
  try {
    const utxos = await fetchUtxos(address);
    const satoshis = utxos.reduce((sum, u) => sum + u.value, 0);
    return { configured: true, address, satoshis, mintMode: "site" };
  } catch {
    return { configured: true, address, satoshis: null, mintMode: "site" };
  }
}

function stubSourceTransaction(outputIndex: number, satoshis: number, lockingScript: LockingScript): Transaction {
  const source = new Transaction();
  source.outputs = Array.from({ length: outputIndex + 1 }, () => ({
    satoshis: 0,
    lockingScript,
  }));
  source.outputs[outputIndex] = { satoshis, lockingScript };
  return source;
}

export async function buildMintTransaction(opts: {
  key: PrivateKey;
  utxos: Utxo[];
  markdown: string;
  contentType: string;
}): Promise<Transaction> {
  const address = opts.key.toAddress();
  const content = new TextEncoder().encode(opts.markdown);
  const inscriptionScript = buildInscriptionLockingScript(address, content, opts.contentType);
  const p2pkh = new P2PKH().lock(address);
  const estimate = estimateMintSats(content.byteLength);

  const tx = new Transaction();
  let total = 0;
  for (const u of opts.utxos) {
    if (u.value <= 0) continue;
    tx.addInput({
      sourceTXID: u.tx_hash,
      sourceOutputIndex: u.tx_pos,
      sourceTransaction: stubSourceTransaction(u.tx_pos, u.value, p2pkh),
      unlockingScriptTemplate: new P2PKH().unlock(opts.key, "all", false, u.value, p2pkh),
    });
    total += u.value;
    if (total >= estimate.neededSats) break;
  }
  if (tx.inputs.length === 0 || total < estimate.neededSats) {
    throw new HttpError(
      503,
      siteWalletFundingMessage({
        address,
        haveSats: total,
        neededSats: estimate.neededSats,
        feeSats: estimate.feeSats,
      }),
    );
  }

  tx.addOutput({ lockingScript: inscriptionScript, satoshis: ORDINAL_SATS });
  tx.addOutput({ lockingScript: p2pkh, change: true });
  await tx.fee(new SatoshisPerKilobyte(FEE_SAT_PER_KB));
  await tx.sign();
  return tx;
}

export async function inscribeMarkdown(
  env: BillingEnv,
  markdown: string,
  contentType: string,
  _map: Record<string, string>,
): Promise<{ txid: string; origin: string }> {
  const wif = env.SITE_WALLET_WIF?.trim();
  if (!wif) throw new HttpError(503, "Site wallet is not configured");
  let key: PrivateKey;
  try {
    key = PrivateKey.fromWif(wif);
  } catch {
    throw new HttpError(503, "Site wallet is not configured");
  }
  try {
    const address = key.toAddress();
    const utxos = await fetchUtxos(address);
    const tx = await buildMintTransaction({ key, utxos, markdown, contentType });
    const hex = tx.toHex();
    const signedId = tx.id("hex");
    const txid = (await broadcastRaw(hex, signedId)).toLowerCase();
    return { txid, origin: nftOriginFromTxid(txid) };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const message = err instanceof Error && err.message ? err.message : "unknown inscription error";
    throw new HttpError(502, `Inscription failed: ${message}`);
  }
}

async function fetchUtxos(address: string): Promise<Utxo[]> {
  const res = await fetch(`${WOC}/address/${address}/unspent`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new HttpError(502, `Could not load site wallet UTXOs (${res.status}) ${body.slice(0, 120)}`);
  }
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => {
      const r = row as { tx_hash?: string; tx_pos?: number; value?: number };
      return {
        tx_hash: String(r.tx_hash ?? ""),
        tx_pos: Number(r.tx_pos ?? 0),
        value: Number(r.value ?? 0),
      };
    })
    .filter((u) => /^[0-9a-f]{64}$/i.test(u.tx_hash) && u.value > 0)
    .sort((a, b) => b.value - a.value);
}

async function broadcastRaw(hex: string, expectedTxid: string): Promise<string> {
  const woc = await fetch(`${WOC}/tx/raw`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txhex: hex }),
  });
  if (woc.ok) {
    const text = (await woc.text()).replace(/"/g, "").trim();
    if (/^[0-9a-f]{64}$/i.test(text)) return text;
  }
  const gorilla = await fetch("https://ordinals.gorillapool.io/api/tx", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rawTx: hex }),
  });
  if (gorilla.ok) {
    const body = (await gorilla.json().catch(() => null)) as { txid?: string; txidhex?: string } | null;
    const id = body?.txid ?? body?.txidhex ?? "";
    if (/^[0-9a-f]{64}$/i.test(id)) return id;
  }
  if (woc.ok || gorilla.ok) return expectedTxid;
  const err = await woc.text().catch(() => "");
  throw new HttpError(502, `Broadcast failed: ${err.slice(0, 200) || woc.status}`);
}
