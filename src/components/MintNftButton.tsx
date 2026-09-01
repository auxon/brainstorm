import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Diamond } from "lucide-react";
import { apiFetch, type SessionGraph, type SessionNft } from "@/lib/api";
import { siteWalletShortfallMessage, type BillingStatus, type NftPrepare } from "@/lib/billing";
import { refreshSession, useSession } from "@/lib/auth";
import { loadSavedOrdAddress, parseOrdAddress, saveOrdAddress } from "@/lib/ord-address";
import { ensureYoursConnected, useYoursWallet } from "@/lib/wallet-store";

export function MintNftButton({
  slug,
  graph,
  onUpdate,
}: {
  slug: string;
  graph: SessionGraph;
  onUpdate: (g: SessionGraph) => void;
}) {
  const navigate = useNavigate();
  const { user } = useSession();
  const yours = useYoursWallet((s) => s.session);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const latest = graph.nfts[0] as SessionNft | undefined;

  function defaultRecipient(): string {
    const saved = loadSavedOrdAddress();
    if (saved) return saved;
    if (yours?.addresses.ordAddress) return yours.addresses.ordAddress;
    if (user?.address?.startsWith("1")) return user.address;
    return "";
  }

  function openDialog() {
    if (!graph.session.canEdit) {
      toast.error("You need edit access to mint this session.");
      return;
    }
    setRecipient(defaultRecipient());
    setOpen(true);
  }

  async function fillFromYours() {
    const ok = await ensureYoursConnected();
    const ord = useYoursWallet.getState().session?.addresses.ordAddress;
    if (!ok || !ord) {
      toast.error("Connect Yours Wallet to fill your 1Sat ordinals address.");
      return;
    }
    setRecipient(ord);
  }

  async function mint() {
    let dest: string;
    try {
      dest = parseOrdAddress(recipient);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid 1Sat address");
      return;
    }
    setBusy(true);
    try {
      const billing = await apiFetch<BillingStatus>("/billing/status");
      if (!billing.active) {
        toast.message("Archive ($9/mo) unlocks NFT minting");
        setOpen(false);
        navigate("/billing");
        return;
      }
      const prepare = await apiFetch<NftPrepare>(`/sessions/${slug}/nft/prepare`, { method: "POST" }, slug);
      const have = billing.siteWallet?.satoshis;
      const address = billing.siteWallet?.address;
      if (
        billing.siteWallet?.configured &&
        address &&
        typeof have === "number" &&
        typeof prepare.neededSats === "number" &&
        have < prepare.neededSats
      ) {
        toast.error(
          siteWalletShortfallMessage({
            address,
            haveSats: have,
            neededSats: prepare.neededSats,
            feeSats: prepare.feeSats,
          }),
          { duration: 20_000 },
        );
        return;
      }
      toast.message("Inscribing with the Brainstorm site wallet…");
      const next = await apiFetch<SessionGraph & { txid?: string; recipient?: string }>(
        `/sessions/${slug}/nft/mint`,
        { method: "POST", body: JSON.stringify({ recipient: dest }) },
        slug,
      );
      saveOrdAddress(dest);
      await refreshSession();
      onUpdate(next);
      setOpen(false);
      toast.success(`Session inscribed to ${next.recipient ?? dest}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Mint failed";
      if (message.toLowerCase().includes("archive subscription")) {
        setOpen(false);
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
        onClick={openDialog}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-raised px-3 text-xs text-muted hover:text-fg disabled:opacity-60"
        title="Inscribe this session as a 1Sat Ordinal via the site wallet"
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
      {open ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={() => !busy && setOpen(false)}>
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-raised p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">Mint 1Sat Ordinal</h2>
            <p className="mt-1 text-sm text-muted">
              The site wallet pays the inscription fee. The NFT is locked to the 1Sat address you paste — usually
              Yours Wallet’s ordinals / 1Sat deposit address (starts with 1).
            </p>
            <label className="mt-4 block text-xs uppercase tracking-wider text-muted" htmlFor="ord-recipient">
              1Sat ordinals address
            </label>
            <input
              id="ord-recipient"
              autoFocus
              spellCheck={false}
              autoComplete="off"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void mint();
                }
              }}
              placeholder="1…"
              className="mt-1 h-10 w-full rounded-lg border border-border bg-bg px-3 font-mono text-sm"
            />
            <button
              type="button"
              onClick={() => void fillFromYours()}
              className="mt-2 text-xs text-accent hover:underline"
            >
              Fill from Yours Wallet
            </button>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
                className="h-9 rounded-lg px-3 text-sm text-muted hover:text-fg"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void mint()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-bg disabled:opacity-60"
              >
                <Diamond className="size-3.5" strokeWidth={1.8} />
                {busy ? "Minting…" : "Mint to this address"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
