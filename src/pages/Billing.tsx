import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Diamond, ExternalLink } from "lucide-react";
import { Shell } from "@/components/Header";
import { apiFetch } from "@/lib/api";
import { refreshSession, useSession } from "@/lib/auth";
import type { BillingStatus } from "@/lib/billing";

export function BillingPage() {
  const { user } = useSession();
  const [params] = useSearchParams();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const next = await apiFetch<BillingStatus>("/billing/status");
    setStatus(next);
    return next;
  }

  useEffect(() => {
    void refresh().catch((err) => toast.error(err instanceof Error ? err.message : "Could not load billing"));
  }, [user?.id]);

  useEffect(() => {
    const checkout = params.get("checkout");
    const sessionId = params.get("session_id");
    if (checkout !== "success") return;
    let cancelled = false;
    void (async () => {
      if (sessionId?.startsWith("cs_")) {
        try {
          await apiFetch("/billing/claim", { method: "POST", body: JSON.stringify({ sessionId }) });
          await refreshSession();
        } catch {
          /* webhook may still land */
        }
      }
      toast.success("Thanks — unlocking Archive. This can take a few seconds.");
      const started = Date.now();
      const tick = window.setInterval(() => {
        void refresh()
          .then((s) => {
            if (cancelled) return;
            if (s.active || Date.now() - started > 20_000) window.clearInterval(tick);
          })
          .catch(() => undefined);
      }, 1500);
    })();
    return () => {
      cancelled = true;
    };
  }, [params]);

  async function checkout() {
    setBusy(true);
    try {
      const { url } = await apiFetch<{ url: string }>("/billing/checkout", { method: "POST" });
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Checkout failed");
      setBusy(false);
    }
  }

  async function portal() {
    setBusy(true);
    try {
      const { url } = await apiFetch<{ url: string }>("/billing/portal", { method: "POST" });
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open billing portal");
      setBusy(false);
    }
  }

  const wallet = status?.siteWallet;
  const funded = (wallet?.satoshis ?? 0) > 0;

  return (
    <Shell>
      <div className="mx-auto max-w-lg">
        <p className="text-xs uppercase tracking-[0.2em] text-muted">Archive</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Mint a brainstorm as an NFT</h1>
        <p className="mt-3 text-muted">
          Archive is ${status?.amountUsd ?? 9}/{status?.interval ?? "month"} via Stripe. No Yours Wallet needed —
          while Archive is active, the Brainstorm site wallet inscribes any board you can edit as a 1Sat
          Ordinal to a 1Sat address you choose. Featured boards (${status?.featureUsd ?? 29} / {status?.featureDays ?? 7} days) and $1 / $3 / $5
          idea boosts are one-time Stripe Checkout payments — they do not start an Archive subscription.
        </p>
        <div className="mt-8 rounded-2xl border border-border bg-raised p-5">
          <div className="flex items-center gap-2 text-accent">
            <Diamond className="size-4" strokeWidth={1.8} />
            <span className="text-sm font-medium">{status?.product ?? "Brainstorm Archive"}</span>
          </div>
          <p className="mt-2 text-3xl font-semibold">
            ${status?.amountUsd ?? 9}
            <span className="text-base font-normal text-muted">/{status?.interval ?? "month"}</span>
          </p>
          <ul className="mt-4 space-y-2 text-sm text-muted">
            <li>You pick the 1Sat address that receives the NFT; the site wallet only pays the fee</li>
            <li>Origin + txid stored on the session</li>
            <li>Cancel anytime in the Stripe customer portal</li>
            <li>Featured ($29 / 7 days) and $1–$5 boosts are separate one-off payments</li>
          </ul>
          {status?.livemode === false ? (
            <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              Stripe is in <span className="font-medium">test mode</span>. Cards will not be charged. Production
              at entangleit.com requires live keys.
            </p>
          ) : null}
          {status?.livemode === true ? (
            <p className="mt-4 text-sm text-accent">Live Checkout — charges settle on the Stripe account.</p>
          ) : null}
          {status?.active ? (
            <p className="mt-4 text-sm text-accent">Archive is active{status.status ? ` (${status.status})` : ""}.</p>
          ) : (
            <p className="mt-4 text-sm text-muted">Not subscribed yet. Stripe Checkout collects payment — no browser wallet.</p>
          )}
          <div className="mt-5 flex flex-col gap-2">
            {status?.active ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void portal()}
                className="h-11 rounded-lg border border-border text-sm font-medium text-fg disabled:opacity-60"
              >
                Manage subscription
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || !status?.configured}
                onClick={() => void checkout()}
                className="h-11 rounded-lg bg-accent text-sm font-medium text-bg disabled:opacity-60"
              >
                {busy ? "Redirecting to Stripe…" : status?.livemode === false ? "Subscribe (test mode)" : "Subscribe with Stripe"}
              </button>
            )}
            {!status?.configured ? (
              <p className="text-xs text-muted">Billing keys are not configured on this Worker yet.</p>
            ) : null}
          </div>
        </div>
        {wallet?.configured ? (
          <p className="mt-4 text-xs text-muted">
            Site wallet {funded ? "is funded" : "is waiting for BSV"}
            {wallet.address ? (
              <>
                {" "}
                at <span className="font-mono break-all">{wallet.address}</span>
              </>
            ) : null}
            {wallet.satoshis != null ? ` · ${wallet.satoshis.toLocaleString()} sats` : null}.
            Inscriptions cost 1 sat plus about 0.05 sat per byte (200 sat fee minimum), so a large
            board can need tens of thousands of sats.
          </p>
        ) : (
          <p className="mt-4 text-xs text-muted">
            NFT minting waits on a site-wallet WIF secret. Yours Wallet is not required for subscribers.
          </p>
        )}
        <p className="mt-6 text-sm text-muted">
          Sales tax / VAT is not collected until Stripe Tax registrations are added in the Dashboard.{" "}
          <Link to="/" className="text-accent hover:underline">
            Back to Brainstorm
          </Link>
          {" · "}
          <a
            href="https://docs.stripe.com/billing/taxes/collect-taxes"
            className="inline-flex items-center gap-1 text-accent hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Tax setup <ExternalLink className="size-3" />
          </a>
        </p>
      </div>
    </Shell>
  );
}
