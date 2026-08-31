export function shortHex(hex: string, head = 6, tail = 4): string {
  if (!hex) return "";
  if (hex.length <= head + tail + 1) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

export function formatSats(sats: number): string {
  if (sats < 1000) return `${sats} sat${sats === 1 ? "" : "s"}`;
  return `${sats.toLocaleString()} sats`;
}

export function formatUsd(cents: number): string {
  const n = (cents || 0) / 100;
  return n % 1 === 0 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`;
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
