import { useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { FEATURE_DAYS, FEATURE_USD } from "@/lib/billing";

export function FeatureButton({
  slug,
  featuredUntil,
  canEdit,
}: {
  slug: string;
  featuredUntil?: number | null;
  canEdit: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const live = Boolean(featuredUntil && featuredUntil > Date.now());

  async function feature() {
    if (!canEdit) {
      toast.error("Only the board owner can feature this map.");
      return;
    }
    setBusy(true);
    try {
      const { url } = await apiFetch<{ url: string }>(
        "/billing/feature",
        { method: "POST", body: JSON.stringify({ slug }) },
        slug,
      );
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start checkout.");
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void feature()}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-raised px-3 text-xs text-muted hover:text-fg disabled:opacity-60"
      title={`Pin this public board on Explore for ${FEATURE_DAYS} days ($${FEATURE_USD})`}
    >
      <Sparkles className="size-3.5" strokeWidth={1.8} />
      {busy ? "Opening…" : live ? `Featured · $${FEATURE_USD} more` : `Feature · $${FEATURE_USD}/${FEATURE_DAYS}d`}
    </button>
  );
}
