/** Compressed identity pubkey of the site yours-agent (MCP poster). */
export const SITE_AGENT_PUBKEY = "02240a561e3f5c00448a36f4e2084261128ab9e8b404afd0748d880d28fcf5da25";
export const GOOGLE_USER_PREFIX = "go_";

export type AuthorKind = "guest" | "agent" | "human";

export function isGoogleUserId(userId: string | null | undefined): boolean {
  return Boolean(userId?.startsWith(GOOGLE_USER_PREFIX));
}

export function authorKind(userId: string | null | undefined): AuthorKind {
  if (!userId) return "guest";
  if (userId === SITE_AGENT_PUBKEY) return "agent";
  if (userId.startsWith("g_")) return "guest";
  return "human";
}

export function authorKindLabel(kind: AuthorKind): string {
  if (kind === "agent") return "Agent";
  if (kind === "guest") return "Guest";
  return "Human";
}

export function ideaHeat(satoshis: number, usdCents: number): number {
  return Math.max(0, (satoshis || 0) + (usdCents || 0) * 10);
}

/** $5 boost (5000 heat) is the visual ceiling. */
export function heatIntensity(heat: number): number {
  if (heat <= 0) return 0;
  return Math.min(1, heat / 5000);
}
