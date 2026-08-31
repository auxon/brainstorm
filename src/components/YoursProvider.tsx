import { useEffect, useState, type ReactNode } from "react";
import { WalletProvider, useWallet } from "@1sat/react";
import { registerWalletControls, useYoursWallet } from "@/lib/wallet-store";

function YoursBridge({ children }: { children: ReactNode }) {
  const { wallet, status, identityKey, connect, disconnect } = useWallet();
  const syncWallet = useYoursWallet((s) => s.syncWallet);

  useEffect(() => {
    registerWalletControls(
      () => connect(),
      () => disconnect(),
    );
  }, [connect, disconnect]);

  useEffect(() => {
    void syncWallet({ status, wallet, identityKey, hasProviders: true });
  }, [status, wallet, identityKey, syncWallet]);

  useEffect(() => {
    function onEvent(e: Event) {
      const action = (e as CustomEvent<{ action?: string }>).detail?.action;
      if (action === "signedOut") {
        void syncWallet({
          status: "disconnected",
          wallet: null,
          identityKey: null,
          hasProviders: true,
        });
      }
    }
    window.addEventListener("YoursEmitEvent", onEvent);
    return () => window.removeEventListener("YoursEmitEvent", onEvent);
  }, [syncWallet]);

  return <>{children}</>;
}

export function YoursProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <>{children}</>;
  return (
    <WalletProvider autoReconnect>
      <YoursBridge>{children}</YoursBridge>
    </WalletProvider>
  );
}
