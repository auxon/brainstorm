import { ArrowUp, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { apiFetch, type SessionGraph } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { BOOST_USD } from "@/lib/billing";
import { cn, formatSats, formatUsd } from "@/lib/format";
import { sendBsvWithYours } from "@/lib/yours";
import { ensureYoursConnected } from "@/lib/wallet-store";

const SAT_BOOSTS = [10, 100, 1000];

export function VoteButton({
  graph,
  slug,
  targetType,
  targetId,
  voteCount,
  satoshis,
  usdCents = 0,
  payAddress,
  onUpdate,
}: {
  graph: SessionGraph;
  slug: string;
  targetType: "idea" | "comment";
  targetId: string;
  voteCount: number;
  satoshis: number;
  usdCents?: number;
  payAddress?: string | null;
  onUpdate: (g: SessionGraph) => void;
}) {
  const { user } = useSession();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const mine = graph.myVotes.some((v) => v.targetType === targetType && v.targetId === targetId);

  async function vote(extraSats = 0, txid: string | null = null) {
    setBusy(true);
    try {
      const next = await apiFetch<SessionGraph>(
        `/sessions/${slug}/votes`,
        { method: "POST", body: JSON.stringify({ targetType, targetId, satoshis: extraSats, txid }) },
        slug,
      );
      onUpdate(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Vote failed");
    } finally {
      setBusy(false);
    }
  }

  async function usdBoost(usd: number) {
    setBusy(true);
    setOpen(false);
    try {
      const { url } = await apiFetch<{ url: string }>(
        "/billing/boost",
        { method: "POST", body: JSON.stringify({ slug, targetType, targetId, usd }) },
        slug,
      );
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start boost checkout");
      setBusy(false);
    }
  }

  async function satBoost(amount: number) {
    if (!user || user.isGuest) {
      toast.message("Connect Yours Wallet for sat boosts, or use a $1–$5 Stripe boost.");
      return;
    }
    if (!payAddress) {
      toast.error("This author has no BSV address yet.");
      return;
    }
    setBusy(true);
    setOpen(false);
    try {
      if (!(await ensureYoursConnected())) throw new Error("Connect Yours Wallet first.");
      toast.message("Approve the upvote payment in Yours Wallet");
      const txid = await sendBsvWithYours([{ address: payAddress, satoshis: amount }]);
      await vote(amount, txid);
      toast.success(`Boosted ${formatSats(amount)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Boost failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => void vote(0)}
        title={mine ? "Remove upvote" : "Upvote"}
        className={cn(
          "inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-medium",
          mine
            ? "border-accent/40 bg-accent/15 text-accent"
            : "border-border bg-raised text-muted hover:text-fg",
        )}
      >
        <ArrowUp className="size-3.5" strokeWidth={2.2} />
        {voteCount}
      </button>
      {satoshis > 0 ? <span className="font-mono text-[11px] text-accent/80">{formatSats(satoshis)}</span> : null}
      {usdCents > 0 ? <span className="font-mono text-[11px] text-accent/80">{formatUsd(usdCents)}</span> : null}
      <div className="relative">
        <button
          type="button"
          disabled={busy}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-raised px-2 text-[11px] text-muted hover:text-fg"
          title="Boost with Stripe ($1 / $3 / $5)"
        >
          <Zap className="size-3" strokeWidth={1.8} />
          Boost
        </button>
        {open ? (
          <div className="absolute right-0 z-20 mt-1 min-w-[140px] rounded-md border border-border bg-raised py-1 shadow-lg">
            {BOOST_USD.map((n) => (
              <button
                key={n}
                type="button"
                className="block w-full px-3 py-1.5 text-left text-xs text-fg hover:bg-bg"
                onClick={() => void usdBoost(n)}
              >
                ${n} boost
              </button>
            ))}
            {payAddress && user && !user.isGuest ? (
              <>
                <div className="my-1 border-t border-border" />
                {SAT_BOOSTS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="block w-full px-3 py-1.5 text-left text-xs text-muted hover:bg-bg hover:text-fg"
                    onClick={() => void satBoost(n)}
                  >
                    {formatSats(n)} (Yours)
                  </button>
                ))}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
