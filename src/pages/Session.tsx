import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { LayoutGrid, Share2, Workflow } from "lucide-react";
import { Shell } from "@/components/Header";
import { IdeaBoard } from "@/components/IdeaBoard";
import { MindMap } from "@/components/MindMap";
import { ShareDialog } from "@/components/ShareDialog";
import { ExportMenu } from "@/components/ExportMenu";
import { MintNftButton } from "@/components/MintNftButton";
import { apiFetch, rememberSession, saveEditToken, type SessionGraph } from "@/lib/api";
import { wsUrl } from "@/lib/base-path";
import { cn } from "@/lib/format";

export function SessionPage() {
  const { slug = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "map" ? "map" : "board";
  const [graph, setGraph] = useState<SessionGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState(false);

  useEffect(() => {
    const k = params.get("k");
    if (k && slug) saveEditToken(slug, k);
  }, [params, slug]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    apiFetch<SessionGraph>(`/sessions/${slug}`, undefined, slug)
      .then((g) => {
        if (cancelled) return;
        setGraph(g);
        rememberSession(g.session.slug, g.session.title);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (!graph) return;
    const ws = new WebSocket(wsUrl(graph.session.id));
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string" || ev.data === "pong") return;
      void apiFetch<SessionGraph>(`/sessions/${slug}`, undefined, slug).then(setGraph).catch(() => undefined);
    };
    return () => ws.close();
  }, [graph?.session.id, slug]);

  if (error) {
    return (
      <Shell>
        <p className="text-red-400">{error}</p>
      </Shell>
    );
  }
  if (!graph) {
    return (
      <Shell>
        <div className="h-40 animate-pulse rounded-xl bg-raised" />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{graph.session.title}</h1>
          {graph.session.description ? <p className="mt-1 text-sm text-muted">{graph.session.description}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border p-0.5">
            <button
              type="button"
              onClick={() => setParams({ view: "board" })}
              className={cn("inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs", view === "board" ? "bg-accent text-bg" : "text-muted")}
            >
              <LayoutGrid className="size-3.5" /> Board
            </button>
            <button
              type="button"
              onClick={() => setParams({ view: "map" })}
              className={cn("inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs", view === "map" ? "bg-accent text-bg" : "text-muted")}
            >
              <Workflow className="size-3.5" /> Map
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShare(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-muted hover:text-fg"
          >
            <Share2 className="size-3.5" /> Share
          </button>
          <ExportMenu slug={slug} />
          <MintNftButton slug={slug} graph={graph} onUpdate={setGraph} />
        </div>
      </div>
      <div className="mt-6">
        {view === "map" ? (
          <MindMap graph={graph} slug={slug} onUpdate={setGraph} />
        ) : (
          <IdeaBoard graph={graph} slug={slug} onUpdate={setGraph} />
        )}
      </div>
      {share ? <ShareDialog graph={graph} slug={slug} onUpdate={setGraph} onClose={() => setShare(false)} /> : null}
    </Shell>
  );
}
