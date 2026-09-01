import { newId } from "./ids";
import type { CommentRow, EdgeRow, IdeaRow, SessionGraph, WalletUser } from "./types";

export const SNAPSHOT_KIND = "brainstorm.session";
export const SNAPSHOT_VERSION = 1;
export const SNAPSHOT_MAX_BYTES = 4 * 1024 * 1024;

export type SessionSnapshot = {
  kind: typeof SNAPSHOT_KIND;
  version: typeof SNAPSHOT_VERSION;
  exportedAt: number;
  session: {
    title: string;
    description: string | null;
    visibility?: string;
    slug?: string;
  };
  ideas: IdeaRow[];
  comments: CommentRow[];
  edges: EdgeRow[];
};

export function buildSnapshot(graph: Pick<SessionGraph, "session" | "ideas" | "comments" | "edges">): SessionSnapshot {
  return {
    kind: SNAPSHOT_KIND,
    version: SNAPSHOT_VERSION,
    exportedAt: Date.now(),
    session: {
      title: graph.session.title,
      description: graph.session.description,
      visibility: graph.session.visibility,
      slug: graph.session.slug,
    },
    ideas: graph.ideas,
    comments: graph.comments,
    edges: graph.edges,
  };
}

export function snapshotJson(snapshot: SessionSnapshot): string {
  return JSON.stringify(snapshot);
}

export function parseSnapshot(raw: string): SessionSnapshot {
  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Drive file is not valid JSON");
  }
  if (!data || typeof data !== "object") throw new Error("Drive file is empty");
  const obj = data as Record<string, unknown>;
  if (obj.kind !== SNAPSHOT_KIND) throw new Error("This file is not a Brainstorm session");
  if (obj.version !== SNAPSHOT_VERSION) throw new Error("Unsupported Brainstorm file version");
  const session = obj.session && typeof obj.session === "object" ? (obj.session as Record<string, unknown>) : {};
  const title = typeof session.title === "string" ? session.title.trim() : "";
  if (!title) throw new Error("Brainstorm file is missing a session title");
  const ideas = Array.isArray(obj.ideas) ? (obj.ideas as IdeaRow[]) : [];
  if (!ideas.length) throw new Error("Brainstorm file has no ideas");
  return {
    kind: SNAPSHOT_KIND,
    version: SNAPSHOT_VERSION,
    exportedAt: typeof obj.exportedAt === "number" ? obj.exportedAt : Date.now(),
    session: {
      title,
      description: typeof session.description === "string" ? session.description : null,
      visibility: typeof session.visibility === "string" ? session.visibility : undefined,
      slug: typeof session.slug === "string" ? session.slug : undefined,
    },
    ideas,
    comments: Array.isArray(obj.comments) ? (obj.comments as CommentRow[]) : [],
    edges: Array.isArray(obj.edges) ? (obj.edges as EdgeRow[]) : [],
  };
}

export function driveFileName(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${cleaned || "Brainstorm"}.brainstorm.json`;
}

/** New ids so a second import never collides with the first. */
export function remapSnapshot(
  snapshot: SessionSnapshot,
  sessionId: string,
  owner: WalletUser,
): { ideas: IdeaRow[]; comments: CommentRow[]; edges: EdgeRow[] } {
  const ids = new Map<string, string>();
  for (const idea of snapshot.ideas) {
    if (idea?.id) ids.set(idea.id, newId());
  }
  for (const comment of snapshot.comments) {
    if (comment?.id) ids.set(comment.id, newId());
  }
  for (const edge of snapshot.edges) {
    if (edge?.id) ids.set(edge.id, newId());
  }
  const mapId = (id: string | null | undefined): string | null => {
    if (!id) return null;
    return ids.get(id) ?? null;
  };

  const ideas = snapshot.ideas.map((idea, index) => {
    const id = mapId(idea.id) ?? newId();
    return {
      ...idea,
      id,
      session_id: sessionId,
      parent_id: mapId(idea.parent_id),
      title: String(idea.title ?? "Untitled").slice(0, 500),
      body: typeof idea.body === "string" ? idea.body : "",
      author_user_id: owner.id,
      author_name: owner.displayName || idea.author_name || "Google",
      author_address: owner.address,
      position_x: typeof idea.position_x === "number" ? idea.position_x : null,
      position_y: typeof idea.position_y === "number" ? idea.position_y : null,
      color: typeof idea.color === "string" ? idea.color : null,
      sort_index: typeof idea.sort_index === "number" ? idea.sort_index : index,
      vote_count: 0,
      satoshis: 0,
      usd_cents: 0,
      created_at: typeof idea.created_at === "number" ? idea.created_at : Date.now(),
      updated_at: Date.now(),
    };
  });

  const ideaIds = new Set(ideas.map((i) => i.id));
  const comments = snapshot.comments
    .filter((c) => c.idea_id && ids.has(c.idea_id))
    .map((comment) => ({
      ...comment,
      id: mapId(comment.id) ?? newId(),
      session_id: sessionId,
      idea_id: mapId(comment.idea_id) as string,
      parent_id: comment.parent_id && ids.has(comment.parent_id) ? mapId(comment.parent_id) : null,
      body: typeof comment.body === "string" ? comment.body : "",
      author_user_id: owner.id,
      author_name: owner.displayName || comment.author_name || "Google",
      author_address: owner.address,
      vote_count: 0,
      satoshis: 0,
      usd_cents: 0,
      created_at: typeof comment.created_at === "number" ? comment.created_at : Date.now(),
    }))
    .filter((c) => ideaIds.has(c.idea_id));

  const edges = snapshot.edges
    .filter((e) => e.source_id && e.target_id && ids.has(e.source_id) && ids.has(e.target_id))
    .map((edge) => ({
      id: mapId(edge.id) ?? newId(),
      session_id: sessionId,
      source_id: mapId(edge.source_id) as string,
      target_id: mapId(edge.target_id) as string,
      label: typeof edge.label === "string" ? edge.label : null,
    }));

  return { ideas, comments, edges };
}
