import { P2PKH } from "@bsv/sdk";

const STORAGE_KEY = "brainstorm.ord-recipient";

export function parseOrdAddress(raw: string): string {
  const address = raw.trim();
  if (!address) throw new Error("Enter a 1Sat Ordinals address (BSV P2PKH, starts with 1).");
  if (address.startsWith("m") || address.startsWith("n") || address.startsWith("2")) {
    throw new Error("Use a mainnet 1Sat address starting with 1, not a testnet address.");
  }
  if (!address.startsWith("1")) {
    throw new Error(
      "1Sat Ordinals need a mainnet P2PKH address starting with 1 (Yours Wallet → Ordinals / 1Sat deposit address).",
    );
  }
  try {
    new P2PKH().lock(address);
  } catch {
    throw new Error("That is not a valid 1Sat / BSV P2PKH address.");
  }
  return address;
}

export function loadSavedOrdAddress(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function saveOrdAddress(address: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, address);
  } catch {
    /* ignore */
  }
}
