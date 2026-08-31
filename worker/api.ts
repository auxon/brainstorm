import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  assertSameOriginPost,
  attachSessionCookie,
  buildClearCookie,
  buildSessionCookie,
  displayNameFor,
  ensureSessionUser,
  getSessionUser,
  isGuestId,
  issueChallenge,
  purgeExpired,
  requestIsSecure,
  revokeSession,
  SIGN_TAG,
  verifyChallenge,
} from "./auth";
import { renderHtml, renderMarkdown } from "./export";
import { nanoid, newId, randomToken, sha256Hex, timingSafeEqualStr } from "./ids";
import { APP_PREFIX } from "./paths";
import { ensureSchema } from "./schema";
import { registerBillingRoutes, transferBilling, userHasArchive } from "./billing";
import {
  disconnectGoogle,
  googleStatus,
  handleGoogleCallback,
  startGoogleOAuth,
} from "./google";
import { importDriveFile, listDriveFiles, saveGraphToDrive } from "./drive";
import { NFT_CONTENT_TYPE, NFT_MAX_BYTES, nftOriginFromTxid, type BillingEnv } from "./billing-lib";
import { inscribeMarkdown } from "./site-wallet";
import { activeFeaturedUntil } from "./commerce";
import type { CommentRow, EdgeRow, IdeaRow, SessionGraph, SessionNft, SessionRow, WalletUser } from "./types";
import { HttpError } from "./types";

type Vars = { user: WalletUser | null };

export const api = new Hono<{ Bindings: Env; Variables: Vars }>().basePath(`${APP_PREFIX}/api`);

api.use("*", async (c, next) => {
  await ensureSchema(c.env.DB);
  c.set("user", await getSessionUser(c.req.raw, c.env.DB));
  await next();
});

api.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as never);
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error("[api]", err);
  return c.json({ error: "internal_error" }, 500);
});

api.get("/health", (c) => c.json({ ok: true, service: "brainstorm" }));

api.get("/explore", async (c) => {
  const now = Date.now();
  const featured = await c.env.DB.prepare(
    `SELECT s.id, s.slug, s.title, s.description, s.visibility, s.owner_user_id, s.created_at, s.updated_at,
            MAX(f.ends_at) as featured_until,
            (SELECT COUNT(*) FROM ideas i WHERE i.session_id = s.id) as idea_count
     FROM featured f JOIN sessions s ON s.id = f.session_id
     WHERE f.ends_at > ? AND s.visibility = 'public'
     GROUP BY s.id
     ORDER BY featured_until DESC
     LIMIT 24`,
  )
    .bind(now)
    .all<{
      id: string;
      slug: string;
      title: string;
      description: string | null;
      visibility: "unlisted" | "public" | "token";
      owner_user_id: string;
      created_at: number;
      updated_at: number;
      featured_until: number;
      idea_count: number;
    }>()
    .then((r) => r.results ?? [])
    .catch(() => [] as never[]);
  const featuredIds = new Set(featured.map((s) => s.id));
  const recent = await c.env.DB.prepare(
    `SELECT id, slug, title, description, visibility, owner_user_id, created_at, updated_at,
            (SELECT COUNT(*) FROM ideas i WHERE i.session_id = sessions.id) as idea_count
     FROM sessions WHERE visibility = 'public' ORDER BY updated_at DESC LIMIT 40`,
  )
    .all<{
      id: string;
      slug: string;
      title: string;
      description: string | null;
      visibility: "unlisted" | "public" | "token";
      owner_user_id: string;
      created_at: number;
      updated_at: number;
      idea_count: number;
    }>()
    .then((r) => r.results ?? []);
  const toCard = (
    s: {
      id: string;
      slug: string;
      title: string;
      description: string | null;
      visibility: "unlisted" | "public" | "token";
      owner_user_id: string;
      created_at: number;
      updated_at: number;
      featured_until?: number;
      idea_count?: number;
    },
    featuredUntil: number | null,
  ) => ({
    ...toPublic(
      {
        ...s,
        view_token: "",
        edit_token: "",
      },
      null,
      false,
      featuredUntil,
    ),
    ideaCount: s.idea_count ?? 0,
  });
  return c.json({
    featured: featured.map((s) => toCard(s, s.featured_until)),
    public: recent.filter((s) => !featuredIds.has(s.id)).map((s) => toCard(s, null)),
  });
});

// ── Wallet auth (SatPress-compatible challenge / BSM / session) ─────────────

api.get("/wallet-auth/session", (c) => c.json({ user: c.get("user") }));

api.post("/wallet-auth/challenge", async (c) => {
  assertSameOriginPost(c.req.raw);
  const body = await readJson(c.req.raw);
  const origin = typeof body.origin === "string" ? body.origin : new URL(c.req.url).origin;
  return c.json(await issueChallenge(c.env.DB, origin));
});

api.post("/wallet-auth/verify", async (c) => {
  assertSameOriginPost(c.req.raw);
  const body = await readJson(c.req.raw);
  for (const key of ["nonce", "message", "sig", "pubKey"] as const) {
    if (typeof body[key] !== "string" || !body[key]) {
      throw new HttpError(400, `Missing ${key}`);
    }
  }
  c.executionCtx.waitUntil(purgeExpired(c.env.DB));
  const previous = c.get("user");
  const { token, user } = await verifyChallenge(c.env.DB, {
    nonce: body.nonce as string,
    message: body.message as string,
    sig: body.sig as string,
    pubKey: body.pubKey as string,
    identityKey: typeof body.identityKey === "string" ? body.identityKey : null,
    address: typeof body.address === "string" ? body.address : null,
  });
  if (previous && isGuestId(previous.id) && previous.id !== user.id) {
    await transferBilling(c.env.DB, previous.id, user.id);
  }
  const secure = requestIsSecure(c.req.raw);
  c.header("set-cookie", buildSessionCookie(token, secure, APP_PREFIX));
  c.header("cache-control", "no-store");
  c.header("x-session-token", token);
  return c.json({ token, ...user, user });
});

api.post("/wallet-auth/signout", async (c) => {
  assertSameOriginPost(c.req.raw);
  await revokeSession(c.req.raw, c.env.DB);
  c.header("set-cookie", buildClearCookie(requestIsSecure(c.req.raw), APP_PREFIX));
  return c.json({ ok: true });
});

// ── Google sign-in + Drive ──────────────────────────────────────────────────

api.get("/auth/google/status", async (c) => c.json(await googleStatus(c.env, c.get("user"))));

api.get("/auth/google/start", async (c) => startGoogleOAuth(c.env, c.req.raw, c.get("user")));

api.get("/auth/google/callback", async (c) => handleGoogleCallback(c.env, c.req.raw));

api.post("/auth/google/disconnect", async (c) => {
  assertSameOriginPost(c.req.raw);
  const user = c.get("user");
  if (!user) throw new HttpError(401, "Sign in first");
  await disconnectGoogle(c.env, user.id);
  return c.json({ ok: true });
});

api.get("/drive/files", async (c) => {
  const user = c.get("user");
  if (!user) throw new HttpError(401, "Sign in with Google to use Drive");
  return c.json({ files: await listDriveFiles(c.env, user.id) });
});

api.post("/drive/import", async (c) => {
  assertSameOriginPost(c.req.raw);
  const user = c.get("user");
  if (!user) throw new HttpError(401, "Sign in with Google to use Drive");
  const body = await readJson(c.req.raw);
  const fileId = typeof body.fileId === "string" ? body.fileId : "";
  if (!fileId) throw new HttpError(400, "fileId is required");
  const imported = await importDriveFile(c.env, user, fileId);
  return c.json({
    session: toPublic(imported.session, user, true),
    editToken: imported.editToken,
    viewToken: imported.viewToken,
  });
});

api.post("/sessions/:slug/drive/save", async (c) => {
  assertSameOriginPost(c.req.raw);
  const user = c.get("user");
  if (!user) throw new HttpError(401, "Sign in with Google to use Drive");
  const graph = await loadGraph(c, { requireEdit: true });
  const saved = await saveGraphToDrive(c.env, user, graph);
  return c.json(saved);
});

// ── Sessions ────────────────────────────────────────────────────────────────

api.post("/sessions", async (c) => {
  assertSameOriginPost(c.req.raw);
  const { user, mintedToken } = await requireActor(c);
  const body = await readJson(c.req.raw);
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) throw new HttpError(400, "Title is required");
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const t = Date.now();
  const id = newId();
  const slug = nanoid(8);
  const viewToken = randomToken();
  const editToken = randomToken();
  await c.env.DB.prepare(
    "INSERT INTO sessions (id, slug, title, description, visibility, view_token, edit_token, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'unlisted', ?, ?, ?, ?, ?)",
  )
    .bind(id, slug, title, description || null, viewToken, editToken, user.id, t, t)
    .run();

  const rootId = newId();
  await c.env.DB.prepare(
    "INSERT INTO ideas (id, session_id, parent_id, title, body, author_user_id, author_name, author_address, position_x, position_y, sort_index, vote_count, satoshis, created_at, updated_at) VALUES (?, ?, NULL, ?, '', ?, ?, ?, 0, 0, 0, 0, 0, ?, ?)",
  )
    .bind(rootId, id, title, user.id, displayNameFor(user), user.address, t, t)
    .run();

  const session = await loadSessionBySlug(c.env.DB, slug);
  if (!session) throw new HttpError(500, "Failed to create session");
  return c.json({
    session: toPublic(session, user, true),
    editToken,
    viewToken,
    token: mintedToken,
    ideas: await listIdeas(c.env.DB, id),
  });
});

api.get("/sessions/:slug", async (c) => {
  const graph = await loadGraph(c);
  return c.json(graph);
});

api.patch("/sessions/:slug", async (c) => {
  assertSameOriginPost(c.req.raw);
  const { session } = await loadGraph(c, { requireEdit: true });
  const body = await readJson(c.req.raw);
  const title = typeof body.title === "string" ? body.title.trim() : session.title;
  const description =
    typeof body.description === "string" ? body.description.trim() : session.description;
  const visibility =
    body.visibility === "unlisted" || body.visibility === "public" || body.visibility === "token"
      ? body.visibility
      : session.visibility;
  await c.env.DB.prepare(
    "UPDATE sessions SET title = ?, description = ?, visibility = ?, updated_at = ? WHERE id = ?",
  )
    .bind(title, description || null, visibility, Date.now(), session.id)
    .run();
  await broadcast(c, session.id, { type: "session.patch" });
  return c.json(await loadGraph(c));
});

api.post("/sessions/:slug/ideas", async (c) => {
  assertSameOriginPost(c.req.raw);
  const { user } = await requireActor(c);
  const { session } = await loadGraph(c, { requireEdit: true });
  const body = await readJson(c.req.raw);
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) throw new HttpError(400, "Idea title is required");
  const ideaBody = typeof body.body === "string" ? body.body : "";
  const parentId = typeof body.parentId === "string" ? body.parentId : null;
  const t = Date.now();
  const id = newId();
  const maxSort = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(sort_index), 0) as m FROM ideas WHERE session_id = ? AND IFNULL(parent_id, '') = ?",
  )
    .bind(session.id, parentId ?? "")
    .first<{ m: number }>();
  await c.env.DB.prepare(
    "INSERT INTO ideas (id, session_id, parent_id, title, body, author_user_id, author_name, author_address, position_x, position_y, color, sort_index, vote_count, satoshis, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)",
  )
    .bind(
      id,
      session.id,
      parentId,
      title,
      ideaBody,
      user.id,
      displayNameFor(user),
      user.address,
      typeof body.positionX === "number" ? body.positionX : null,
      typeof body.positionY === "number" ? body.positionY : null,
      typeof body.color === "string" ? body.color : null,
      (maxSort?.m ?? 0) + 1,
      t,
      t,
    )
    .run();
  await touch(c.env.DB, session.id);
  await broadcast(c, session.id, { type: "idea.upsert", ideaId: id });
  return c.json(await loadGraph(c));
});

api.patch("/sessions/:slug/ideas/:id", async (c) => {
  assertSameOriginPost(c.req.raw);
  const { session } = await loadGraph(c, { requireEdit: true });
  const idea = await getIdea(c.env.DB, c.req.param("id"), session.id);
  const body = await readJson(c.req.raw);
  const title = typeof body.title === "string" ? body.title.trim() : idea.title;
  const ideaBody = typeof body.body === "string" ? body.body : idea.body;
  const parentId = body.parentId === null ? null : typeof body.parentId === "string" ? body.parentId : idea.parent_id;
  const color = typeof body.color === "string" ? body.color : idea.color;
  const px = typeof body.positionX === "number" ? body.positionX : idea.position_x;
  const py = typeof body.positionY === "number" ? body.positionY : idea.position_y;
  await c.env.DB.prepare(
    "UPDATE ideas SET title = ?, body = ?, parent_id = ?, color = ?, position_x = ?, position_y = ?, updated_at = ? WHERE id = ?",
  )
    .bind(title, ideaBody, parentId, color, px, py, Date.now(), idea.id)
    .run();
  await touch(c.env.DB, session.id);
  await broadcast(c, session.id, { type: "idea.upsert", ideaId: idea.id });
  return c.json(await loadGraph(c));
});

api.delete("/sessions/:slug/ideas/:id", async (c) => {
  assertSameOriginPost(c.req.raw);
  const { session } = await loadGraph(c, { requireEdit: true });
  const idea = await getIdea(c.env.DB, c.req.param("id"), session.id);
  await c.env.DB.prepare("UPDATE ideas SET parent_id = ? WHERE parent_id = ? AND session_id = ?")
    .bind(idea.parent_id, idea.id, session.id)
    .run();
  await c.env.DB.prepare("DELETE FROM comments WHERE idea_id = ?").bind(idea.id).run();
  await c.env.DB.prepare("DELETE FROM votes WHERE target_type = 'idea' AND target_id = ?").bind(idea.id).run();
  await c.env.DB.prepare("DELETE FROM edges WHERE source_id = ? OR target_id = ?").bind(idea.id, idea.id).run();
  await c.env.DB.prepare("DELETE FROM ideas WHERE id = ?").bind(idea.id).run();
  await touch(c.env.DB, session.id);
  await broadcast(c, session.id, { type: "idea.delete", ideaId: idea.id });
  return c.json(await loadGraph(c));
});

api.post("/sessions/:slug/ideas/:id/comments", async (c) => {
  assertSameOriginPost(c.req.raw);
  const { user } = await requireActor(c);
  const { session } = await loadGraph(c, { requireEdit: true });
  const idea = await getIdea(c.env.DB, c.req.param("id"), session.id);
  const body = await readJson(c.req.raw);
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) throw new HttpError(400, "Comment is required");
  const parentId = typeof body.parentId === "string" ? body.parentId : null;
  const id = newId();
  const t = Date.now();
  await c.env.DB.prepare(
    "INSERT INTO comments (id, session_id, idea_id, parent_id, body, author_user_id, author_name, author_address, vote_count, satoshis, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)",
  )
    .bind(id, session.id, idea.id, parentId, text, user.id, displayNameFor(user), user.address, t)
    .run();
  await touch(c.env.DB, session.id);
  await broadcast(c, session.id, { type: "comment.add", commentId: id });
  return c.json(await loadGraph(c));
});

api.post("/sessions/:slug/edges", async (c) => {
  assertSameOriginPost(c.req.raw);
  const { session } = await loadGraph(c, { requireEdit: true });
  const body = await readJson(c.req.raw);
  const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";
  const targetId = typeof body.targetId === "string" ? body.targetId : "";
  if (!sourceId || !targetId || sourceId === targetId) throw new HttpError(400, "Invalid edge");
  await getIdea(c.env.DB, sourceId, session.id);
  await getIdea(c.env.DB, targetId, session.id);
  const id = newId();
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO edges (id, session_id, source_id, target_id, label) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(id, session.id, sourceId, targetId, typeof body.label === "string" ? body.label : null)
    .run();
  await broadcast(c, session.id, { type: "edge.upsert" });
  return c.json(await loadGraph(c));
});

api.delete("/sessions/:slug/edges/:id", async (c) => {
  assertSameOriginPost(c.req.raw);
  const { session } = await loadGraph(c, { requireEdit: true });
  await c.env.DB.prepare("DELETE FROM edges WHERE id = ? AND session_id = ?")
    .bind(c.req.param("id"), session.id)
    .run();
  await broadcast(c, session.id, { type: "edge.delete" });
  return c.json(await loadGraph(c));
});

api.post("/sessions/:slug/votes", async (c) => {
  assertSameOriginPost(c.req.raw);
  const { user } = await requireActor(c);
  const { session } = await loadGraph(c);
  const body = await readJson(c.req.raw);
  const targetType = body.targetType === "comment" ? "comment" : body.targetType === "idea" ? "idea" : null;
  const targetId = typeof body.targetId === "string" ? body.targetId : "";
  if (!targetType || !targetId) throw new HttpError(400, "targetType and targetId required");
  await assertTarget(c.env.DB, session.id, targetType, targetId);

  const satoshis = Number.isFinite(Number(body.satoshis)) ? Math.max(0, Math.floor(Number(body.satoshis))) : 0;
  const txid = typeof body.txid === "string" ? body.txid : null;
  const existing = await c.env.DB.prepare(
    "SELECT id, satoshis, usd_cents FROM votes WHERE user_id = ? AND target_type = ? AND target_id = ?",
  )
    .bind(user.id, targetType, targetId)
    .first<{ id: string; satoshis: number; usd_cents?: number }>();

  const table = targetType === "idea" ? "ideas" : "comments";

  if (satoshis > 0) {
    if (existing) {
      await c.env.DB.prepare("UPDATE votes SET satoshis = satoshis + ?, txid = COALESCE(?, txid) WHERE id = ?")
        .bind(satoshis, txid, existing.id)
        .run();
    } else {
      await c.env.DB.prepare(
        "INSERT INTO votes (id, session_id, target_type, target_id, user_id, satoshis, txid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(newId(), session.id, targetType, targetId, user.id, satoshis, txid, Date.now())
        .run();
      await c.env.DB.prepare(`UPDATE ${table} SET vote_count = vote_count + 1 WHERE id = ?`).bind(targetId).run();
    }
    await c.env.DB.prepare(`UPDATE ${table} SET satoshis = satoshis + ? WHERE id = ?`).bind(satoshis, targetId).run();
  } else if (existing) {
    const paid = (existing.satoshis || 0) > 0 || (existing.usd_cents || 0) > 0;
    if (!paid) {
      await c.env.DB.prepare("DELETE FROM votes WHERE id = ?").bind(existing.id).run();
      await c.env.DB.prepare(`UPDATE ${table} SET vote_count = MAX(vote_count - 1, 0) WHERE id = ?`)
        .bind(targetId)
        .run();
    }
  } else {
    await c.env.DB.prepare(
      "INSERT INTO votes (id, session_id, target_type, target_id, user_id, satoshis, txid, created_at) VALUES (?, ?, ?, ?, ?, 0, NULL, ?)",
    )
      .bind(newId(), session.id, targetType, targetId, user.id, Date.now())
      .run();
    await c.env.DB.prepare(`UPDATE ${table} SET vote_count = vote_count + 1 WHERE id = ?`).bind(targetId).run();
  }

  await broadcast(c, session.id, { type: "vote", targetType, targetId });
  return c.json(await loadGraph(c));
});

api.get("/sessions/:slug/export.md", async (c) => {
  const graph = await loadGraph(c);
  const md = renderMarkdown(graph);
  return new Response(md, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${graph.session.slug}.md"`,
    },
  });
});

api.get("/sessions/:slug/export.html", async (c) => {
  const graph = await loadGraph(c);
  return new Response(renderHtml(graph), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `attachment; filename="${graph.session.slug}.html"`,
    },
  });
});

api.post("/sessions/:slug/nft/prepare", async (c) => {
  assertSameOriginPost(c.req.raw);
  const { user } = await requireActor(c);
  const graph = await loadGraph(c, { requireEdit: true });
  if (!(await userHasArchive(c.env.DB, user.id))) {
    throw new HttpError(402, "Archive subscription required to mint an NFT");
  }
  const markdown = renderMarkdown(graph);
  const bytes = new TextEncoder().encode(markdown).byteLength;
  if (bytes > NFT_MAX_BYTES) throw new HttpError(413, "Session is too large to inscribe in a single ordinal");
  const contentHash = await sha256Hex(markdown);
  return c.json({
    markdown,
    contentHash,
    contentType: NFT_CONTENT_TYPE,
    bytes,
    map: {
      app: "brainstorm",
      type: "brainstorm-session",
      slug: graph.session.slug,
      title: graph.session.title,
      url: `https://entangleit.com/brainstorm/s/${graph.session.slug}`,
      sha256: contentHash,
    },
  });
});

api.post("/sessions/:slug/nft", async (c) => {
  assertSameOriginPost(c.req.raw);
  const { user } = await requireActor(c);
  const graph = await loadGraph(c, { requireEdit: true });
  if (!(await userHasArchive(c.env.DB, user.id))) {
    throw new HttpError(402, "Archive subscription required to mint an NFT");
  }
  const body = await readJson(c.req.raw);
  const txid = typeof body.txid === "string" ? body.txid.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(txid)) throw new HttpError(400, "Invalid txid");
  const markdown = renderMarkdown(graph);
  const contentHash = await sha256Hex(markdown);
  if (typeof body.contentHash === "string" && body.contentHash !== contentHash) {
    throw new HttpError(409, "Session changed since you prepared the inscription — try minting again");
  }
  const origin =
    typeof body.origin === "string" && body.origin.trim()
      ? body.origin.trim()
      : nftOriginFromTxid(txid);
  const existing = await c.env.DB.prepare("SELECT id FROM nfts WHERE txid = ?").bind(txid).first();
  if (!existing) {
    await c.env.DB.prepare(
      "INSERT INTO nfts (id, session_id, origin, txid, content_hash, content_type, minted_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(newId(), graph.session.id, origin, txid, contentHash, NFT_CONTENT_TYPE, user.id, Date.now())
      .run();
  }
  await touch(c.env.DB, graph.session.id);
  await broadcast(c, graph.session.id, { type: "nft.mint", txid, origin });
  return c.json(await loadGraph(c));
});

api.post("/sessions/:slug/nft/mint", async (c) => {
  assertSameOriginPost(c.req.raw);
  const { user } = await requireActor(c);
  const graph = await loadGraph(c, { requireEdit: true });
  if (!(await userHasArchive(c.env.DB, user.id))) {
    throw new HttpError(402, "Archive subscription required to mint an NFT");
  }
  const markdown = renderMarkdown(graph);
  const bytes = new TextEncoder().encode(markdown).byteLength;
  if (bytes > NFT_MAX_BYTES) throw new HttpError(413, "Session is too large to inscribe in a single ordinal");
  const contentHash = await sha256Hex(markdown);
  const minted = await inscribeMarkdown(c.env as BillingEnv, markdown, NFT_CONTENT_TYPE, {
    app: "brainstorm",
    type: "brainstorm-session",
    slug: graph.session.slug,
    title: graph.session.title,
    url: `https://entangleit.com/brainstorm/s/${graph.session.slug}`,
    sha256: contentHash,
  });
  const existing = await c.env.DB.prepare("SELECT id FROM nfts WHERE txid = ?").bind(minted.txid).first();
  if (!existing) {
    await c.env.DB.prepare(
      "INSERT INTO nfts (id, session_id, origin, txid, content_hash, content_type, minted_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(newId(), graph.session.id, minted.origin, minted.txid, contentHash, NFT_CONTENT_TYPE, user.id, Date.now())
      .run();
  }
  await touch(c.env.DB, graph.session.id);
  await broadcast(c, graph.session.id, { type: "nft.mint", txid: minted.txid, origin: minted.origin });
  const next = await loadGraph(c);
  return c.json({ ...next, txid: minted.txid, origin: minted.origin, contentHash });
});

registerBillingRoutes(api);

export { SIGN_TAG };

// ── helpers ─────────────────────────────────────────────────────────────────

async function requireActor(c: {
  get: (k: "user") => WalletUser | null;
  set: (k: "user", v: WalletUser) => void;
  env: Env;
  req: { raw: Request };
  header: (n: string, v: string) => void;
}): Promise<{ user: WalletUser; mintedToken: string | null }> {
  const { user, mintedToken } = await ensureSessionUser(c.env.DB, c.get("user"));
  if (mintedToken) {
    c.set("user", user);
    attachSessionCookie((n, v) => c.header(n, v), c.req.raw, mintedToken);
  }
  return { user, mintedToken };
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function presentedToken(request: Request): string | null {
  const url = new URL(request.url);
  const q = url.searchParams.get("k");
  if (q) return q;
  return request.headers.get("x-token");
}

function canView(session: SessionRow, token: string | null): boolean {
  if (session.visibility !== "token") return true;
  if (!token) return false;
  return timingSafeEqualStr(token, session.view_token) || timingSafeEqualStr(token, session.edit_token);
}

function canEdit(session: SessionRow, token: string | null, user: WalletUser | null): boolean {
  if (user && user.id === session.owner_user_id) return true;
  if (!token) return false;
  return timingSafeEqualStr(token, session.edit_token);
}

function toPublic(
  session: SessionRow,
  user: WalletUser | null,
  edit: boolean,
  featuredUntil: number | null = null,
) {
  return {
    id: session.id,
    slug: session.slug,
    title: session.title,
    description: session.description,
    visibility: session.visibility,
    owner_user_id: session.owner_user_id,
    created_at: session.created_at,
    updated_at: session.updated_at,
    canEdit: edit,
    isOwner: Boolean(user && user.id === session.owner_user_id),
    featuredUntil,
  };
}

async function loadSessionBySlug(db: D1Database, slug: string): Promise<SessionRow | null> {
  return db.prepare("SELECT * FROM sessions WHERE slug = ?").bind(slug).first<SessionRow>();
}

async function listIdeas(db: D1Database, sessionId: string): Promise<IdeaRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM ideas WHERE session_id = ? ORDER BY sort_index ASC, created_at ASC")
    .bind(sessionId)
    .all<IdeaRow>();
  return results ?? [];
}

async function loadGraph(
  c: {
    req: { raw: Request; param: (k: string) => string };
    env: Env;
    get: (k: "user") => WalletUser | null;
  },
  opts: { requireEdit?: boolean } = {},
): Promise<SessionGraph> {
  const slug = c.req.param("slug");
  const session = await loadSessionBySlug(c.env.DB, slug);
  if (!session) throw new HttpError(404, "Session not found");
  const token = presentedToken(c.req.raw);
  const user = c.get("user");
  if (!canView(session, token)) throw new HttpError(403, "This session requires a view link");
  const edit = canEdit(session, token, user);
  if (opts.requireEdit && !edit) throw new HttpError(403, "Edit access required");
  const featuredUntil = await activeFeaturedUntil(c.env.DB, session.id).catch(() => null);

  const [ideas, comments, edges, votes, nfts] = await Promise.all([
    listIdeas(c.env.DB, session.id),
    c.env.DB.prepare("SELECT * FROM comments WHERE session_id = ? ORDER BY created_at ASC")
      .bind(session.id)
      .all<CommentRow>()
      .then((r) => r.results ?? []),
    c.env.DB.prepare("SELECT * FROM edges WHERE session_id = ?")
      .bind(session.id)
      .all<EdgeRow>()
      .then((r) => r.results ?? []),
    user
      ? c.env.DB.prepare("SELECT target_type as targetType, target_id as targetId, satoshis FROM votes WHERE session_id = ? AND user_id = ?")
          .bind(session.id, user.id)
          .all<{ targetType: "idea" | "comment"; targetId: string; satoshis: number }>()
          .then((r) => r.results ?? [])
      : Promise.resolve([]),
    c.env.DB.prepare(
      "SELECT id, origin, txid, content_hash as contentHash, content_type as contentType, minted_by as mintedBy, created_at as createdAt FROM nfts WHERE session_id = ? ORDER BY created_at DESC",
    )
      .bind(session.id)
      .all<SessionNft>()
      .then((r) => r.results ?? [])
      .catch(() => [] as SessionNft[]),
  ]);

  return {
    session: toPublic(session, user, edit, featuredUntil),
    ideas,
    comments,
    edges,
    myVotes: votes,
    nfts,
  };
}

async function getIdea(db: D1Database, id: string, sessionId: string): Promise<IdeaRow> {
  const row = await db
    .prepare("SELECT * FROM ideas WHERE id = ? AND session_id = ?")
    .bind(id, sessionId)
    .first<IdeaRow>();
  if (!row) throw new HttpError(404, "Idea not found");
  return row;
}

async function assertTarget(
  db: D1Database,
  sessionId: string,
  type: "idea" | "comment",
  id: string,
): Promise<void> {
  if (type === "idea") {
    await getIdea(db, id, sessionId);
    return;
  }
  const row = await db
    .prepare("SELECT id FROM comments WHERE id = ? AND session_id = ?")
    .bind(id, sessionId)
    .first();
  if (!row) throw new HttpError(404, "Comment not found");
}

async function touch(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").bind(Date.now(), sessionId).run();
}

async function broadcast(
  c: { env: Env; executionCtx: { waitUntil(promise: Promise<unknown>): void } },
  sessionId: string,
  event: Record<string, unknown>,
): Promise<void> {
  c.executionCtx.waitUntil(
    c.env.SESSION.getByName(sessionId).broadcast(JSON.stringify({ ...event, at: Date.now() })),
  );
}
