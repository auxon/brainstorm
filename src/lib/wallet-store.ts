import { create } from "zustand";
import {
  buildContext,
  buildSession,
  getActiveContext,
  setActiveContext,
  type YoursSession,
} from "./yours";

export type WalletStatus = "detecting" | "missing" | "available" | "connecting" | "connected";

type WalletState = {
  status: WalletStatus;
  session: YoursSession | null;
  error: string | null;
  hydrated: boolean;
  syncWallet: (input: {
    status: "disconnected" | "detecting" | "selecting" | "connecting" | "connected";
    wallet: unknown;
    identityKey: string | null;
    hasProviders: boolean;
  }) => Promise<void>;
  connect: () => Promise<YoursSession>;
  disconnect: () => Promise<void>;
};

let connector: (() => Promise<void>) | null = null;
let disconnector: (() => void) | null = null;

export function registerWalletControls(connectFn: () => Promise<void>, disconnectFn: () => void): void {
  connector = connectFn;
  disconnector = disconnectFn;
}

let syncing = false;

export async function ensureYoursConnected(): Promise<boolean> {
  const s = useYoursWallet.getState();
  if (s.status === "connected" && s.session) return true;
  if (s.status === "missing") return false;
  try {
    if (s.status !== "connected") await s.connect();
    return useYoursWallet.getState().status === "connected" && Boolean(useYoursWallet.getState().session);
  } catch {
    return false;
  }
}

export const useYoursWallet = create<WalletState>((set, get) => ({
  status: "detecting",
  session: null,
  error: null,
  hydrated: false,

  syncWallet: async ({ status, wallet, identityKey, hasProviders }) => {
    if (syncing) return;
    syncing = true;
    try {
      if (status !== "connected") {
        setActiveContext(null);
        set((prev) => ({
          status:
            status === "connecting" || status === "selecting"
              ? "connecting"
              : status === "detecting"
                ? prev.hydrated
                  ? prev.status
                  : "detecting"
                : hasProviders
                  ? "available"
                  : "missing",
          session: null,
          hydrated: true,
        }));
        return;
      }
      if (!wallet) return;
      setActiveContext(buildContext(wallet as Parameters<typeof buildContext>[0]));
      try {
        const session = await buildSession(identityKey ?? "");
        set({ status: "connected", session, error: null, hydrated: true });
      } catch (err) {
        set({
          status: "available",
          session: null,
          error: err instanceof Error ? err.message : "Could not read Yours Wallet addresses.",
          hydrated: true,
        });
      }
    } finally {
      syncing = false;
    }
  },

  connect: async () => {
    if (!connector) throw new Error("Yours Wallet is not installed. Install it in Chrome, then reload.");
    set({ status: "connecting", error: null });
    try {
      await connector();
      for (let i = 0; i < 50 && get().status !== "connected"; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const session = get().session;
      if (get().status !== "connected" || !session) {
        throw new Error(get().error ?? "Yours Wallet did not connect.");
      }
      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not connect Yours Wallet.";
      set({ status: getActiveContext() ? "available" : "missing", error: message, hydrated: true });
      throw err instanceof Error ? err : new Error(message);
    }
  },

  disconnect: async () => {
    disconnector?.();
    setActiveContext(null);
    set({ status: "available", session: null, error: null });
  },
}));
