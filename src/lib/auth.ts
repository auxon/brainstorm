/**
 * Yours BRC-100 wallet authentication — browser side.
 * Same challenge → signBsm → verify flow as SatPress.
 */
import { useEffect, useState } from "react";
import { signBsm } from "@1sat/actions";
import { apiUrl } from "./base-path";
import { getActiveContext } from "./yours";

const SIGN_TAG = { label: "brainstorm", id: "login", domain: "entangleit.com", meta: {} };
const BEARER_KEY = "brainstorm.bearer-token";

export function getBearerToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(BEARER_KEY);
  } catch {
    return null;
  }
}

export function setBearerToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) window.sessionStorage.setItem(BEARER_KEY, token);
    else window.sessionStorage.removeItem(BEARER_KEY);
  } catch {
    /* ignore */
  }
}

export type SessionUser = {
  id: string;
  identityKey?: string | null;
  address?: string | null;
  handle?: string | null;
  displayName?: string | null;
};

async function authFetch<T>(action: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = getBearerToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(apiUrl(`/wallet-auth/${action}`), {
    ...init,
    headers,
    credentials: "include",
  });
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(body?.error ?? `auth request failed (${res.status})`);
  return body as T;
}

export function wrapWalletAuthError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err ?? "Unknown error");
  const lower = raw.toLowerCase();
  if (lower.includes("user-rejected") || lower.includes("reject") || lower.includes("denied")) {
    return new Error("Signature was rejected in Yours Wallet.");
  }
  if (lower.includes("not-connected") || lower.includes("connect")) {
    return new Error("Connect Yours Wallet first.");
  }
  return new Error(raw);
}

export async function walletSignIn(identityKeyHint?: string | null, address?: string | null): Promise<SessionUser> {
  const ctx = getActiveContext();
  if (!ctx) throw new Error("Connect Yours Wallet first.");
  const origin = window.location.origin;
  const { nonce, message } = await authFetch<{ nonce: string; message: string }>("challenge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ origin }),
  });
  const signed = await signBsm.execute(ctx, { message, encoding: "utf8", tag: SIGN_TAG });
  if (!signed.sig || !signed.pubKey) {
    throw wrapWalletAuthError(new Error(signed.error ?? "Wallet returned no signature"));
  }
  const result = await authFetch<SessionUser & { token?: string; user?: SessionUser }>("verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      nonce,
      message,
      sig: signed.sig,
      pubKey: signed.pubKey,
      identityKey: identityKeyHint ?? null,
      address: address ?? signed.address ?? null,
    }),
  });
  setBearerToken(result.token ?? null);
  const user = result.user ?? result;
  publishSession(user);
  return user;
}

export async function walletSignOut(): Promise<void> {
  try {
    await authFetch("signout", { method: "POST" });
  } finally {
    setBearerToken(null);
    publishSession(null);
  }
}

let lastKnownUser: SessionUser | null | undefined;
const listeners = new Set<() => void>();

function publishSession(user: SessionUser | null): void {
  lastKnownUser = user;
  for (const fn of listeners) fn();
}

export async function refreshSession(): Promise<SessionUser | null> {
  try {
    const data = await authFetch<{ user: SessionUser | null }>("session");
    lastKnownUser = data.user?.id ? data.user : null;
  } catch {
    lastKnownUser = null;
  }
  publishSession(lastKnownUser);
  return lastKnownUser ?? null;
}

type SessionState = { user: SessionUser | null; isPending: boolean };

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>(() =>
    lastKnownUser === undefined ? { user: null, isPending: true } : { user: lastKnownUser, isPending: false },
  );
  useEffect(() => {
    const listener = () => setState({ user: lastKnownUser ?? null, isPending: false });
    listeners.add(listener);
    if (lastKnownUser === undefined) void refreshSession();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return state;
}
