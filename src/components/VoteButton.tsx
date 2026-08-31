import { ArrowUp, Zap } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useState } from "react";
import { apiFetch, type SessionGraph } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { cn, formatSats } from "@/lib/format";
import { sendBsvWithYours } from "@/lib/yours";
import { ensureYoursConnected } from "@/lib/wallet-store";

const BOOSTS = [10, 100, 1000];

export function VoteButton({
  graph,
  slug,
  targetType,
  targetId,
  voteCount,
  satoshis,
  payAddress,
  onUpdate,
}: {
  graph: SessionGraph;
  slug: string;
  targetType: "idea" | "comment";
  targetId: string;
  voteCount: number;
  satoshis: number;
  payAddress?: string | null;
  onUpdate: (g: SessionGraph) => void;
}) {
  const { user } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
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

  async function boost(amount: number) {
    if (!user || user.isGuest) {
      navigate("/login");
      return;
    }
    if (!payAddress) {
      toast.error("This author has no BSV address yet.");
      return;
    }
    setBusy(true);
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
      {satoshis > 0 ? (
        <span className="font-mono text-[11px] text-accent/80">{formatSats(satoshis)}</span>
      ) : null}
      {payAddress && user && !user.isGuest ? (
        <div className="group relative">
          <button
            type="button"
            disabled={busy}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-raised px-2 text-[11px] text-muted hover:text-fg"
            title="Boost with sats via Yours Wallet"
          >
            <Zap className="size-3" strokeWidth={1.8} />
            Boost
          </button>
          <div className="invisible absolute left-0 z-20 mt-1 flex flex-col rounded-md border border-border bg-raised py-1 opacity-0 shadow-lg group-hover:visible group-hover:opacity-100">
            {BOOSTS.map((n) => (
              <button
                key={n}
                type="button"
                className="px-3 py-1.5 text-left text-xs text-fg hover:bg-bg"
                onClick={() => void boost(n)}
              >
                {formatSats(n)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
