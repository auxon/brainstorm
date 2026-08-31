import { inscribe } from "@1sat/actions";
import { requireContext, wrapWalletError } from "./yours";
import type { NftPrepare } from "./billing";

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export async function inscribeSessionMarkdown(prep: NftPrepare): Promise<{ txid: string; origin: string; contentHash: string }> {
  const ctx = requireContext();
  const result = await inscribe.execute(ctx, {
    base64Content: utf8ToBase64(prep.markdown),
    contentType: prep.contentType,
    map: prep.map,
  });
  if (!result.txid) throw wrapWalletError(new Error(result.error ?? "Inscription returned no txid"), "Mint");
  const origin = `${result.txid.toLowerCase()}_0`;
  return { txid: result.txid.toLowerCase(), origin, contentHash: result.contentHash ?? prep.contentHash };
}
