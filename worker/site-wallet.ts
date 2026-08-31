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

type Utxo = { tx_hash: string; tx_pos: number; value: number };

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
  const address = key.toAddress();
  const utxos = await fetchUtxos(address);
  const content = new TextEncoder().encode(markdown);
  const inscriptionScript = buildInscriptionLockingScript(address, content, contentType);
  const p2pkh = new P2PKH().lock(address);
  const approxFee = Math.max(200, Math.ceil((content.byteLength + 400) / 1000) * FEE_SAT_PER_KB);
  const needed = 1 + approxFee + 1;

  const tx = new Transaction();
  let total = 0;
  for (const u of utxos) {
    if (u.value <= 0) continue;
    tx.addInput({
      sourceTXID: u.tx_hash,
      sourceOutputIndex: u.tx_pos,
      unlockingScriptTemplate: new P2PKH().unlock(key, "all", false, u.value, p2pkh),
    });
    total += u.value;
    if (total >= needed) break;
  }
  if (tx.inputs.length === 0 || total < needed) {
    throw new HttpError(
      503,
      `Site wallet needs BSV to inscribe. Send sats to ${address}`,
    );
  }

  tx.addOutput({ lockingScript: inscriptionScript, satoshis: 1 });
  tx.addOutput({ lockingScript: p2pkh, change: true });
  await tx.fee(new SatoshisPerKilobyte(FEE_SAT_PER_KB));
  await tx.sign();
  const hex = tx.toHex();
  const signedId = tx.id("hex");
  const txid = (await broadcastRaw(hex, signedId)).toLowerCase();
  return { txid, origin: nftOriginFromTxid(txid) };
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
