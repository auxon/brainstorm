import type { CommentRow, IdeaRow, SessionGraph } from "./types";

export const PUBLIC_SITE = "https://entangleit.com/brainstorm";

const BODY_PREVIEW = 180;
const COMMENTS_PER_IDEA = 3;

export function sessionUrl(slug: string): string {
  return `${PUBLIC_SITE}/s/${slug}`;
}

function preview(text: string, max = BODY_PREVIEW): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

function commentsFor(comments: CommentRow[], ideaId: string): CommentRow[] {
  return comments.filter((c) => c.idea_id === ideaId).sort((a, b) => a.created_at - b.created_at);
}

export type IdeaSummary = {
  id: string;
  parentId: string | null;
  title: string;
  body?: string;
  author: string;
  votes: number;
  satoshis: number;
  commentCount: number;
  comments?: { id: string; author: string; body: string; votes: number; satoshis: number }[];
};

export type SessionSummary = {
  url: string;
  session: {
    slug: string;
    title: string;
    description: string | null;
    visibility: string;
    canEdit: boolean;
    isOwner: boolean;
    ideaCount: number;
    commentCount: number;
    edgeCount: number;
  };
  ideas: IdeaSummary[];
  edges: { id: string; sourceId: string; targetId: string; label: string | null }[];
  myVotes: SessionGraph["myVotes"];
};

/**
 * Compact graph for MCP tool results — titles, vote totals, and short previews
 * instead of dumping every field agents do not need.
 */
export function summarizeSession(graph: SessionGraph): SessionSummary {
  const byParent = new Map<string | null, IdeaRow[]>();
  for (const idea of graph.ideas) {
    const key = idea.parent_id;
    const list = byParent.get(key) ?? [];
    list.push(idea);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sort_index - b.sort_index || a.created_at - b.created_at);
  }

  const ideas: IdeaSummary[] = [];
  function walk(parentId: string | null) {
    for (const idea of byParent.get(parentId) ?? []) {
      const thread = commentsFor(graph.comments, idea.id);
      const recent = thread.slice(-COMMENTS_PER_IDEA);
      ideas.push({
        id: idea.id,
        parentId: idea.parent_id,
        title: idea.title,
        body: preview(idea.body),
        author: idea.author_name,
        votes: idea.vote_count,
        satoshis: idea.satoshis,
        commentCount: thread.length,
        comments: recent.length
          ? recent.map((c) => ({
              id: c.id,
              author: c.author_name,
              body: preview(c.body, 120) ?? "",
              votes: c.vote_count,
              satoshis: c.satoshis,
            }))
          : undefined,
      });
      walk(idea.id);
    }
  }
  walk(null);

  return {
    url: sessionUrl(graph.session.slug),
    session: {
      slug: graph.session.slug,
      title: graph.session.title,
      description: graph.session.description,
      visibility: graph.session.visibility,
      canEdit: graph.session.canEdit,
      isOwner: graph.session.isOwner,
      ideaCount: graph.ideas.length,
      commentCount: graph.comments.length,
      edgeCount: graph.edges.length,
    },
    ideas,
    edges: graph.edges.map((e) => ({
      id: e.id,
      sourceId: e.source_id,
      targetId: e.target_id,
      label: e.label,
    })),
    myVotes: graph.myVotes,
  };
}
