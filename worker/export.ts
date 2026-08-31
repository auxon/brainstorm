import type { CommentRow, EdgeRow, IdeaRow, PublicSession } from "./types";

export type ExportGraph = {
  session: Pick<PublicSession, "slug" | "title" | "description">;
  ideas: IdeaRow[];
  comments: CommentRow[];
  edges: EdgeRow[];
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function childrenOf(ideas: IdeaRow[], parentId: string | null): IdeaRow[] {
  return ideas
    .filter((i) => i.parent_id === parentId)
    .sort((a, b) => a.sort_index - b.sort_index || a.created_at - b.created_at);
}

function commentsFor(comments: CommentRow[], ideaId: string): CommentRow[] {
  return comments.filter((c) => c.idea_id === ideaId).sort((a, b) => a.created_at - b.created_at);
}

function heading(depth: number, title: string): string {
  const level = Math.min(6, Math.max(1, depth));
  return `${"#".repeat(level)} ${title}`;
}

export function renderMarkdown(graph: ExportGraph): string {
  const origin = `https://entangleit.com/brainstorm/s/${graph.session.slug}`;
  const lines: string[] = [`# ${graph.session.title}`, ""];
  if (graph.session.description) {
    lines.push(`> ${graph.session.description}`, "");
  }
  lines.push(`_Exported from ${origin}_`, "");

  function walk(parentId: string | null, depth: number) {
    for (const idea of childrenOf(graph.ideas, parentId)) {
      lines.push(heading(depth, idea.title), "");
      if (idea.body) lines.push(idea.body, "");
      const meta = [`${idea.vote_count} ↑`];
      if (idea.satoshis > 0) meta.push(`${idea.satoshis} sats`);
      lines.push(`— ${idea.author_name} · ${meta.join(" · ")}`, "");
      for (const c of commentsFor(graph.comments, idea.id)) {
        const cMeta = c.satoshis > 0 ? ` · ${c.satoshis} sats` : "";
        lines.push(`> **${c.author_name}** (${c.vote_count} ↑${cMeta}) · ${c.body}`, "");
      }
      walk(idea.id, depth + 1);
    }
  }
  walk(null, 2);

  if (graph.edges.length) {
    lines.push("## See also", "");
    const byId = new Map(graph.ideas.map((i) => [i.id, i]));
    for (const e of graph.edges) {
      const from = byId.get(e.source_id)?.title ?? e.source_id;
      const to = byId.get(e.target_id)?.title ?? e.target_id;
      const label = e.label ? ` (${e.label})` : "";
      lines.push(`- [${from}](#${slugify(from)}) → [${to}](#${slugify(to)})${label}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderHtml(graph: ExportGraph): string {
  const origin = `https://entangleit.com/brainstorm/s/${graph.session.slug}`;
  const mdish: string[] = [];

  function walk(parentId: string | null) {
    for (const idea of childrenOf(graph.ideas, parentId)) {
      mdish.push(`<section class="idea">`);
      mdish.push(`<h2>${escapeHtml(idea.title)}</h2>`);
      if (idea.body) mdish.push(`<p>${escapeHtml(idea.body).replace(/\n/g, "<br/>")}</p>`);
      mdish.push(
        `<p class="meta">${escapeHtml(idea.author_name)} · ${idea.vote_count} ↑${idea.satoshis ? ` · ${idea.satoshis} sats` : ""}</p>`,
      );
      const comments = commentsFor(graph.comments, idea.id);
      if (comments.length) {
        mdish.push(`<ul class="comments">`);
        for (const c of comments) {
          mdish.push(
            `<li><strong>${escapeHtml(c.author_name)}</strong> (${c.vote_count} ↑${c.satoshis ? ` · ${c.satoshis} sats` : ""}) — ${escapeHtml(c.body)}</li>`,
          );
        }
        mdish.push(`</ul>`);
      }
      const kids = childrenOf(graph.ideas, idea.id);
      if (kids.length) mdish.push(`<div class="children">`);
      walk(idea.id);
      if (kids.length) mdish.push(`</div>`);
      mdish.push(`</section>`);
    }
  }
  walk(null);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(graph.session.title)} · Brainstorm</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font: 16px/1.5 system-ui, sans-serif; background: #0b0f14; color: #e8eef5; }
    main { max-width: 44rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
    h1 { font-size: 2rem; letter-spacing: -0.03em; margin: 0 0 .5rem; }
    .lede { color: #8b9bb0; }
    a { color: #2ee6c8; }
    .idea { border: 1px solid #243042; background: #141b24; border-radius: 12px; padding: 1rem 1.1rem; margin: .8rem 0; }
    .idea h2 { font-size: 1.15rem; margin: 0 0 .4rem; }
    .meta { color: #8b9bb0; font-size: .85rem; }
    .comments { color: #c5d0dc; font-size: .95rem; }
    .children { margin-left: .6rem; border-left: 2px solid #243042; padding-left: .8rem; }
  </style>
</head>
<body>
<main>
  <p class="lede">Brainstorm export · <a href="${escapeHtml(origin)}">${escapeHtml(origin)}</a></p>
  <h1>${escapeHtml(graph.session.title)}</h1>
  ${graph.session.description ? `<p class="lede">${escapeHtml(graph.session.description)}</p>` : ""}
  ${mdish.join("\n")}
</main>
</body>
</html>
`;
}
