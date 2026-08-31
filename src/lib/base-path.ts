/**
 * Public URL prefix. Vite `base` is `/brainstorm/` in both local and prod so
 * the SPA, API, and Worker rewrite stay aligned.
 */
export const BASE_URL = import.meta.env.BASE_URL || "/brainstorm/";
export const BASE_PATH = BASE_URL.replace(/\/+$/, "") || "/brainstorm";

export function withBase(path: string): string {
  if (!path) return `${BASE_PATH}/`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized === BASE_PATH || normalized.startsWith(`${BASE_PATH}/`)) return normalized;
  return `${BASE_PATH}${normalized}`;
}

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_PATH}/api${p}`;
}

export function wsUrl(sessionId: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${BASE_PATH}/ws/${sessionId}`;
}
