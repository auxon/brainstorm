import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Diamond } from "lucide-react";
import { apiFetch, type SessionGraph, type SessionNft } from "@/lib/api";
import type { BillingStatus, NftPrepare } from "@/lib/billing";
import { useSession } from "@/lib/auth";
import { inscribeSessionMarkdown } from "@/lib/inscribe";
import { ensureYoursConnected } from "@/lib/wallet-store";

export function MintNftButton({
  slug,
  graph,
  onUpdate,
}: {
  slug: string;
  graph: SessionGraph;
  onUpdate: (g: SessionGraph) => void;
}) {
  const { user } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const latest = graph.nfts[0] as SessionNft | undefined;

  async function mint() {
    if (!user) {
      navigate("/login");
      return;
    }
    if (!graph.session.canEdit) {
      toast.error("You need edit access to mint this session.");
      return;
    }
    setBusy(true);
    try {
      const billing = await apiFetch<BillingStatus>("/billing/status");
      if (!billing.active) {
        toast.message("Archive ($9/mo) unlocks NFT minting");
        navigate("/billing");
        return;
      }
      if (!(await ensureYoursConnected())) throw new Error("Connect Yours Wallet first.");
      const prep = await apiFetch<NftPrepare>(`/sessions/${slug}/nft/prepare`, { method: "POST" }, slug);
      toast.message("Approve the inscription in Yours Wallet (1 sat + fees)");
      const minted = await inscribeSessionMarkdown(prep);
      const next = await apiFetch<SessionGraph>(
        `/sessions/${slug}/nft`,
        { method: "POST", body: JSON.stringify(minted) },
        slug,
      );
      onUpdate(next);
      toast.success("Session inscribed as a 1Sat Ordinal");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Mint failed";
      if (message.toLowerCase().includes("archive subscription")) {
        navigate("/billing");
      }
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void mint()}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-raised px-3 text-xs text-muted hover:text-fg disabled:opacity-60"
        title="Inscribe this session as a 1Sat Ordinal NFT"
      >
        <Diamond className="size-3.5" strokeWidth={1.8} />
        {busy ? "Minting…" : latest ? "Mint update" : "Mint NFT"}
      </button>
      {latest ? (
        <a
          href={`https://whatsonchain.com/tx/${latest.txid}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[11px] text-accent hover:underline"
        >
          {latest.origin.slice(0, 10)}…
        </a>
      ) : null}
    </div>
  );
}
