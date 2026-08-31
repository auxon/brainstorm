import { useState } from "react";
import { MessageSquare, Plus, Trash2 } from "lucide-react";
import type { Comment, Idea, SessionGraph } from "@/lib/api";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";
import { VoteButton } from "./VoteButton";

export function IdeaBoard({
  graph,
  slug,
  onUpdate,
}: {
  graph: SessionGraph;
  slug: string;
  onUpdate: (g: SessionGraph) => void;
}) {
  const roots = graph.ideas.filter((i) => !i.parent_id);
  return (
    <div className="space-y-3">
      {graph.session.canEdit ? (
        <AddIdea slug={slug} parentId={null} onUpdate={onUpdate} placeholder="Add a root idea…" />
      ) : null}
      {roots.map((idea) => (
        <IdeaCard key={idea.id} idea={idea} graph={graph} slug={slug} onUpdate={onUpdate} depth={0} />
      ))}
    </div>
  );
}

function IdeaCard({
  idea,
  graph,
  slug,
  onUpdate,
  depth,
}: {
  idea: Idea;
  graph: SessionGraph;
  slug: string;
  onUpdate: (g: SessionGraph) => void;
  depth: number;
}) {
  const kids = graph.ideas.filter((i) => i.parent_id === idea.id);
  const comments = graph.comments.filter((c) => c.idea_id === idea.id);
  const [open, setOpen] = useState(true);
  const [showComments, setShowComments] = useState(comments.length > 0);

  async function remove() {
    if (!confirm("Delete this idea? Children move up one level.")) return;
    try {
      onUpdate(await apiFetch<SessionGraph>(`/sessions/${slug}/ideas/${idea.id}`, { method: "DELETE" }, slug));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete");
    }
  }

  return (
    <article
      className="rounded-xl border border-border bg-raised p-4"
      style={{ marginLeft: depth ? Math.min(depth, 4) * 12 : 0 }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-medium text-fg">{idea.title}</h3>
          {idea.body ? <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{idea.body}</p> : null}
          <p className="mt-2 text-[11px] text-muted">
            {idea.author_name}
            {kids.length ? (
              <button type="button" className="ml-2 hover:text-fg" onClick={() => setOpen((v) => !v)}>
                {open ? "Hide" : "Show"} {kids.length} nested
              </button>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <VoteButton
            graph={graph}
            slug={slug}
            targetType="idea"
            targetId={idea.id}
            voteCount={idea.vote_count}
            satoshis={idea.satoshis}
            payAddress={idea.author_address}
            onUpdate={onUpdate}
          />
          {graph.session.canEdit ? (
            <button type="button" onClick={() => void remove()} className="text-muted hover:text-red-400">
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg"
          onClick={() => setShowComments((v) => !v)}
        >
          <MessageSquare className="size-3.5" />
          {comments.length} comment{comments.length === 1 ? "" : "s"}
        </button>
      </div>
      {showComments ? (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          {comments.map((c) => (
            <CommentRow key={c.id} comment={c} graph={graph} slug={slug} onUpdate={onUpdate} />
          ))}
          {graph.session.canEdit ? (
            <AddComment slug={slug} ideaId={idea.id} onUpdate={onUpdate} />
          ) : null}
        </div>
      ) : null}
      {open && graph.session.canEdit ? (
        <div className="mt-3">
          <AddIdea slug={slug} parentId={idea.id} onUpdate={onUpdate} placeholder="Add a nested idea…" />
        </div>
      ) : null}
      {open
        ? kids.map((child) => (
            <div key={child.id} className="mt-3">
              <IdeaCard idea={child} graph={graph} slug={slug} onUpdate={onUpdate} depth={depth + 1} />
            </div>
          ))
        : null}
    </article>
  );
}

function CommentRow({
  comment,
  graph,
  slug,
  onUpdate,
}: {
  comment: Comment;
  graph: SessionGraph;
  slug: string;
  onUpdate: (g: SessionGraph) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg bg-bg/60 px-3 py-2">
      <p className="text-sm text-fg">
        <span className="font-medium">{comment.author_name}</span>{" "}
        <span className="text-muted">{comment.body}</span>
      </p>
      <VoteButton
        graph={graph}
        slug={slug}
        targetType="comment"
        targetId={comment.id}
        voteCount={comment.vote_count}
        satoshis={comment.satoshis}
        payAddress={comment.author_address}
        onUpdate={onUpdate}
      />
    </div>
  );
}

function AddIdea({
  slug,
  parentId,
  onUpdate,
  placeholder,
}: {
  slug: string;
  parentId: string | null;
  onUpdate: (g: SessionGraph) => void;
  placeholder: string;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      onUpdate(
        await apiFetch<SessionGraph>(
          `/sessions/${slug}/ideas`,
          { method: "POST", body: JSON.stringify({ title: title.trim(), parentId }) },
          slug,
        ),
      );
      setTitle("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add idea");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="flex gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={placeholder}
        className="h-9 flex-1 rounded-lg border border-border bg-bg px-3 text-sm text-fg outline-none placeholder:text-muted focus:border-accent"
      />
      <button
        type="submit"
        disabled={busy}
        className="inline-flex h-9 items-center gap-1 rounded-lg bg-accent px-3 text-sm font-medium text-bg disabled:opacity-60"
      >
        <Plus className="size-3.5" />
        Add
      </button>
    </form>
  );
}

function AddComment({
  slug,
  ideaId,
  onUpdate,
}: {
  slug: string;
  ideaId: string;
  onUpdate: (g: SessionGraph) => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      onUpdate(
        await apiFetch<SessionGraph>(
          `/sessions/${slug}/ideas/${ideaId}/comments`,
          { method: "POST", body: JSON.stringify({ body: body.trim() }) },
          slug,
        ),
      );
      setBody("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not comment");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="flex gap-2">
      <input
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write a comment…"
        className="h-8 flex-1 rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none placeholder:text-muted focus:border-accent"
      />
      <button type="submit" disabled={busy} className="h-8 rounded-md border border-border px-2 text-xs text-muted hover:text-fg">
        Reply
      </button>
    </form>
  );
}
