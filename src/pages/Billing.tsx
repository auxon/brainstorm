import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Diamond, ExternalLink } from "lucide-react";
import { Shell } from "@/components/Header";
import { apiFetch } from "@/lib/api";
import { useSession } from "@/lib/auth";
import type { BillingStatus } from "@/lib/billing";

export function BillingPage() {
  const { user, isPending } = useSession();
  const navigate = useNavigate();
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
    if (params.get("checkout") !== "success") return;
    toast.success("Thanks — unlocking Archive. This can take a few seconds.");
    const started = Date.now();
    const tick = window.setInterval(() => {
      void refresh()
        .then((s) => {
          if (s.active || Date.now() - started > 20_000) window.clearInterval(tick);
        })
        .catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(tick);
  }, [params]);

  async function checkout() {
    if (!user) {
      navigate("/login");
      return;
    }
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

  return (
    <Shell>
      <div className="mx-auto max-w-lg">
        <p className="text-xs uppercase tracking-[0.2em] text-muted">Archive</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Mint a brainstorm as an NFT</h1>
        <p className="mt-3 text-muted">
          Archive is ${status?.amountUsd ?? 9}/{status?.interval ?? "month"} via Stripe. While it is active you can
          inscribe any session you can edit as a 1Sat Ordinal — the Markdown snapshot lives on BSV, not just in D1.
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
            <li>Inscribe the current board as a 1Sat Ordinal NFT</li>
            <li>Origin + txid stored on the session</li>
            <li>Cancel anytime in the Stripe customer portal</li>
          </ul>
          {status?.active ? (
            <p className="mt-4 text-sm text-accent">Archive is active{status.status ? ` (${status.status})` : ""}.</p>
          ) : (
            <p className="mt-4 text-sm text-muted">
              {isPending ? "Checking wallet…" : user ? "Not subscribed yet." : "Sign in with Yours Wallet to subscribe."}
            </p>
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
                disabled={busy || isPending || !status?.configured}
                onClick={() => void checkout()}
                className="h-11 rounded-lg bg-accent text-sm font-medium text-bg disabled:opacity-60"
              >
                {busy ? "Redirecting to Stripe…" : "Subscribe with Stripe"}
              </button>
            )}
            {!status?.configured ? (
              <p className="text-xs text-muted">Billing keys are not configured on this Worker yet.</p>
            ) : null}
          </div>
        </div>
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
