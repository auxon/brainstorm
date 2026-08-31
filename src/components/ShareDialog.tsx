import { useState } from "react";
import { toast } from "sonner";
import { apiFetch, type SessionGraph } from "@/lib/api";
import { getEditToken } from "@/lib/api";
import { withBase } from "@/lib/base-path";

export function ShareDialog({
  graph,
  slug,
  onUpdate,
  onClose,
}: {
  graph: SessionGraph;
  slug: string;
  onUpdate: (g: SessionGraph) => void;
  onClose: () => void;
}) {
  const origin = window.location.origin;
  const viewUrl = `${origin}${withBase(`/s/${slug}`)}`;
  const editToken = getEditToken(slug);
  const editUrl = editToken ? `${viewUrl}?k=${editToken}` : null;
  const [visibility, setVisibility] = useState(graph.session.visibility);

  async function saveVis(next: SessionGraph["session"]["visibility"]) {
    setVisibility(next);
    try {
      onUpdate(
        await apiFetch<SessionGraph>(
          `/sessions/${slug}`,
          { method: "PATCH", body: JSON.stringify({ visibility: next }) },
          slug,
        ),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update visibility");
    }
  }

  function copy(text: string, label: string) {
    void navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-raised p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Share session</h2>
        <p className="mt-1 text-sm text-muted">
          Anyone with the view link can read. The edit link can change the map. Featuring a board ($29 / 7 days)
          also flips visibility to public so it can appear on Explore.
        </p>
        <label className="mt-4 block text-xs uppercase tracking-wider text-muted">Visibility</label>
        <select
          value={visibility}
          disabled={!graph.session.canEdit}
          onChange={(e) => void saveVis(e.target.value as typeof visibility)}
          className="mt-1 h-9 w-full rounded-lg border border-border bg-bg px-2 text-sm"
        >
          <option value="unlisted">Unlisted — anyone with the URL</option>
          <option value="token">Token — view token required</option>
          <option value="public">Public</option>
        </select>
        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={() => copy(viewUrl, "View link")}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-left text-sm"
          >
            Copy view link
          </button>
          {editUrl && graph.session.canEdit ? (
            <button
              type="button"
              onClick={() => copy(editUrl, "Edit link")}
              className="w-full rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-left text-sm text-accent"
            >
              Copy edit link
            </button>
          ) : null}
        </div>
        <button type="button" onClick={onClose} className="mt-4 text-sm text-muted hover:text-fg">
          Close
        </button>
      </div>
    </div>
  );
}
