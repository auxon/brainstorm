import { toast } from "sonner";
import { Wallet } from "lucide-react";
import { cn, formatSats, shortHex } from "@/lib/format";
import { useYoursWallet } from "@/lib/wallet-store";
import { YOURS_CHROME } from "@/lib/yours";
import { refreshSession, useSession, walletSignIn, walletSignOut, wrapWalletAuthError } from "@/lib/auth";
import { useState } from "react";

export function WalletButton({ className }: { className?: string }) {
  const { status, session, connect } = useYoursWallet();
  const { user, isPending } = useSession();
  const [busy, setBusy] = useState(false);

  async function onSignIn() {
    setBusy(true);
    try {
      if (!session) await connect();
      const next = useYoursWallet.getState().session;
      await walletSignIn(next?.identity ?? null, next?.addresses.bsvAddress ?? null);
      await refreshSession();
      toast.success("Signed in with Yours Wallet");
    } catch (err) {
      toast.error(wrapWalletAuthError(err).message);
    } finally {
      setBusy(false);
    }
  }

  if (status === "detecting" || isPending) {
    return <div className={cn("h-9 w-28 animate-pulse rounded-lg bg-raised", className)} />;
  }

  if (user) {
    return (
      <button
        type="button"
        title="Sign out"
        onClick={() => void walletSignOut()}
        className={cn(
          "flex h-9 max-w-[46vw] items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-2 text-xs text-accent sm:px-3",
          className,
        )}
      >
        <Wallet className="size-3.5 shrink-0" strokeWidth={1.8} />
        <span className="truncate font-mono">{shortHex(user.displayName || user.id)}</span>
        {session?.balance ? (
          <span className="hidden font-mono text-muted sm:inline">{formatSats(session.balance.satoshis)}</span>
        ) : null}
      </button>
    );
  }

  if (status === "missing") {
    return (
      <a
        href={YOURS_CHROME}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-raised px-3 text-xs text-muted hover:text-fg",
          className,
        )}
      >
        <Wallet className="size-3.5" strokeWidth={1.8} />
        Install Yours
      </a>
    );
  }

  return (
    <button
      type="button"
      disabled={busy || status === "connecting"}
      onClick={() => void onSignIn()}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-bg hover:brightness-110 disabled:opacity-60",
        className,
      )}
    >
      <Wallet className="size-3.5" strokeWidth={1.8} />
      {busy || status === "connecting" ? "Signing…" : "Sign in with Yours"}
    </button>
  );
}
