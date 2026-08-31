export type PublicSession = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  visibility: "unlisted" | "public" | "token";
  owner_user_id: string;
  created_at: number;
  updated_at: number;
  canEdit: boolean;
  isOwner: boolean;
};

export type Idea = {
  id: string;
  session_id: string;
  parent_id: string | null;
  title: string;
  body: string;
  author_user_id: string;
  author_name: string;
  author_address: string | null;
  position_x: number | null;
  position_y: number | null;
  color: string | null;
  sort_index: number;
  vote_count: number;
  satoshis: number;
  created_at: number;
  updated_at: number;
};

export type Comment = {
  id: string;
  session_id: string;
  idea_id: string;
  parent_id: string | null;
  body: string;
  author_user_id: string;
  author_name: string;
  author_address: string | null;
  vote_count: number;
  satoshis: number;
  created_at: number;
};

export type Edge = {
  id: string;
  session_id: string;
  source_id: string;
  target_id: string;
  label: string | null;
};

export type SessionNft = {
  id: string;
  origin: string;
  txid: string;
  contentHash: string;
  contentType: string;
  mintedBy: string;
  createdAt: number;
};

export type SessionGraph = {
  session: PublicSession;
  ideas: Idea[];
  comments: Comment[];
  edges: Edge[];
  myVotes: { targetType: "idea" | "comment"; targetId: string; satoshis: number }[];
  nfts: SessionNft[];
};

const TOKEN_KEY = (slug: string) => `brainstorm:session:${slug}`;
const RECENT_KEY = "brainstorm:recent";

export function getEditToken(slug: string): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY(slug));
  } catch {
    return null;
  }
}

export function saveEditToken(slug: string, token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY(slug), token);
  } catch {
    /* ignore */
  }
}

export type RecentSession = { slug: string; title: string; at: number };

export function listRecent(): RecentSession[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as RecentSession[]) : [];
  } catch {
    return [];
  }
}

export function rememberSession(slug: string, title: string): void {
  const next = [{ slug, title, at: Date.now() }, ...listRecent().filter((r) => r.slug !== slug)].slice(0, 12);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function tokenFromUrl(): string | null {
  const k = new URLSearchParams(window.location.search).get("k");
  return k || null;
}

import { apiUrl } from "./base-path";
import { getBearerToken } from "./auth";

export async function apiFetch<T>(path: string, init?: RequestInit, slug?: string): Promise<T> {
  const headers = new Headers(init?.headers);
  const bearer = getBearerToken();
  if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
  const token = (slug ? getEditToken(slug) : null) || tokenFromUrl();
  if (token) headers.set("X-Token", token);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(apiUrl(path), { ...init, headers, credentials: "include" });
  if (res.headers.get("content-type")?.includes("text/markdown") || res.headers.get("content-type")?.includes("text/html")) {
    return res as unknown as T;
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export function votedSet(graph: SessionGraph, type: "idea" | "comment"): Set<string> {
  return new Set(graph.myVotes.filter((v) => v.targetType === type).map((v) => v.targetId));
}
