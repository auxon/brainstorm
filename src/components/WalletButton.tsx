import { toast } from "sonner";
import { Wallet } from "lucide-react";
import { Link } from "react-router";
import { cn, formatSats, shortHex } from "@/lib/format";
import { useYoursWallet } from "@/lib/wallet-store";
import { refreshSession, useSession, walletSignOut } from "@/lib/auth";
import { useState } from "react";

export function WalletButton({ className }: { className?: string }) {
  const { session } = useYoursWallet();
  const { user, isPending } = useSession();
  const [busy, setBusy] = useState(false);

  if (isPending) {
    return <div className={cn("h-9 w-28 animate-pulse rounded-lg bg-raised", className)} />;
  }

  if (user && !user.isGuest) {
    const label = user.displayName || user.email || shortHex(user.id);
    return (
      <button
        type="button"
        title="Sign out"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void walletSignOut()
            .then(() => refreshSession())
            .catch((err) => toast.error(err instanceof Error ? err.message : "Sign out failed"))
            .finally(() => setBusy(false));
        }}
        className={cn(
          "flex h-9 max-w-[46vw] items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-2 text-xs text-accent sm:px-3",
          className,
        )}
      >
        {user.picture ? (
          <img src={user.picture} alt="" className="size-4 rounded-full" referrerPolicy="no-referrer" />
        ) : (
          <Wallet className="size-3.5 shrink-0" strokeWidth={1.8} />
        )}
        <span className="truncate">{label}</span>
        {session?.balance ? (
          <span className="hidden font-mono text-muted sm:inline">{formatSats(session.balance.satoshis)}</span>
        ) : null}
      </button>
    );
  }

  return (
    <Link
      to="/login"
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-raised px-3 text-xs text-muted hover:text-fg",
        className,
      )}
      title="Sign in with Google or an optional BSV wallet"
    >
      Sign in
    </Link>
  );
}
