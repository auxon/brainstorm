# Brainstorm — Architecture Plan

Product: a collaborative idea board and mind-map app for EntangleIT.

**Public URL:** [https://entangleit.com/brainstorm](https://entangleit.com/brainstorm)

This document is the implementation plan. The current repo is an unused Next.js 14 starter (`create-next-app`, April 2024) plus unused `@babbage/sdk` / `scrypt-cli` dependencies. Those are replaced by a React + Vite + Cloudflare Workers stack.

---

## 1. Product

Brainstorm lets people capture ideas, discuss them, and arrange them as shareable mind maps. A session is the unit of work: a titled board that holds ideas, comments, and a spatial graph. Anyone with a link can view a session; people with an edit token can change it. Sessions export to Markdown or a self-contained HTML file.

### In scope (v1)

- Create a brainstorm session (title, optional description)
- Post ideas, nest them, and comment on them
- Arrange ideas as a mind map (drag nodes, auto-layout, zoom/pan)
- Share a session via URL (view or edit)
- Export the session to `.md` or `.html`
- Guest identity (display name stored locally, no account required)

### Out of scope (v1)

- User accounts, OAuth, email, or Babbage/BSV identity
- Real-time presence avatars / video
- AI idea generation (Workers AI is a later add-on)
- File attachments / images in nodes
- Public global feed of all sessions (unlisted-by-default is safer)

### Later (v2+)

- Live multiplayer cursors and presence
- Cloudflare Access or passkeys for owned sessions
- Workers AI “expand this idea” assistant
- Import Markdown / OPML back into a session
- Version history

---

## 2. Stack

| Layer | Choice | Why |
| --- | --- | --- |
| UI | React 19 + TypeScript | Requested; SPA is enough for this product |
| Bundler | Vite 7 | Requested; native HMR |
| Routing (client) | React Router 7 in **library / SPA mode** | Nested routes without SSR complexity |
| Worker runtime | Cloudflare Workers + [`@cloudflare/vite-plugin`](https://developers.cloudflare.com/workers/vite-plugin/) | Same process for API, assets, and DOs; `workerd` in `vite dev` |
| Worker HTTP | Hono | Small, typed, works on Workers |
| Persistence | D1 (SQLite) | Sessions, ideas, comments, share tokens |
| Live maps | Durable Object + WebSocket Hibernation | One object per session; connections survive eviction |
| Mind map UI | `@xyflow/react` (React Flow) + `elkjs` | Canvas, edges, auto-layout |
| Styling | Tailwind CSS 4 | Fast, already present in spirit in this repo |
| Export | Client-side `Blob` download; optional Worker HTML snapshot | No extra storage for v1 |
| Tests | Vitest + `@cloudflare/vitest-pool-workers` | Worker + DO tests in-runtime |

Scaffold command when implementation starts:

```bash
npm create cloudflare@latest -- brainstorm --framework=react
```

That yields `src/` (React SPA), `worker/index.ts` (API), `vite.config.ts`, and `wrangler.jsonc`. Adapt it in place of the Next.js tree rather than nesting a second app.

---

## 3. Hosting at `/brainstorm`

`entangleit.com` already serves a site at `/`. This app must **not** take over the zone. Use a **Workers route** on the path prefix, not a Custom Domain (Custom Domains own the whole hostname).

```jsonc
{
  "name": "brainstorm",
  "compatibility_date": "2026-08-31",
  "compatibility_flags": ["nodejs_compat"],
  "main": "./worker/index.ts",
  "routes": [
    {
      "pattern": "entangleit.com/brainstorm*",
      "zone_name": "entangleit.com"
    }
  ],
  "assets": {
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/brainstorm/api/*", "/brainstorm/ws/*"]
  }
}
```

Prerequisite: `entangleit.com` is an orange-clouded zone on the same Cloudflare account. Routes require an existing proxied DNS record; they do not create one.

### Path prefix (the important part)

Vite `base` rewrites **URLs in HTML**, not the files on disk:

| Setting | Result |
| --- | --- |
| `base: "/brainstorm/"` | `<script src="/brainstorm/assets/index-….js">` |
| Build output | `dist/index.html`, `dist/assets/…` (no `brainstorm/` folder) |

Incoming request `GET /brainstorm/assets/index-….js` will not match `assets/index-….js` unless the Worker strips the prefix before `env.ASSETS.fetch()`.

**Canonical approach:**

1. Vite `base: "/brainstorm/"`.
2. React Router `basename="/brainstorm"`.
3. Worker: if path starts with `/brainstorm/api` or `/brainstorm/ws`, handle it; otherwise rewrite pathname (`/brainstorm` → `/`, `/brainstorm/s/abc` → `/s/abc`) and `ASSETS.fetch` the rewritten request.
4. SPA fallback: unknown non-file paths serve `index.html`.

Locally, `vite dev` uses the same base so links match production. Optional `VITE_BASE=/` for standalone preview.

### URL map

| Path | Owner |
| --- | --- |
| `/brainstorm` | SPA home — create / open sessions |
| `/brainstorm/s/:slug` | Session: board + mind map |
| `/brainstorm/s/:slug/export` | Export UI (also reachable from the session toolbar) |
| `/brainstorm/api/*` | Worker (Hono) |
| `/brainstorm/ws/:sessionId` | Upgrade to session Durable Object |

Share links are just session URLs, optionally with `?k=<view-or-edit-token>`.

---

## 4. Information architecture

One **session** is both the discussion board and the mind map. Ideas are nodes. Nesting (`parent_id`) is the tree. Optional extra edges allow cross-links. Comments hang off ideas and do not appear as map nodes unless promoted.

```
Session
  ├── Idea (root)
  │     ├── Idea (child)
  │     │     └── Idea (grandchild)
  │     └── Comment thread
  └── Extra edge (A ──related──► B)
```

This keeps Markdown export a tree walk, while the canvas can still show cross-links.

### Client routes

```
/                         home, “New session”, recent (local)
/s/:slug                  session workspace
  ?view=board             idea list / thread (default)
  ?view=map               mind map canvas
/s/:slug/i/:ideaId        deep-link to one idea (board focuses, map selects)
```

Home does not list other people’s unlisted sessions. A “recent on this device” list lives in `localStorage`.

---

## 5. Data model (D1)

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'unlisted'
    CHECK (visibility IN ('unlisted', 'public', 'token')),
  view_token TEXT NOT NULL,
  edit_token TEXT NOT NULL,
  owner_client_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE ideas (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES ideas(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  author_client_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  position_x REAL,
  position_y REAL,
  color TEXT,
  sort_index INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  author_client_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE edges (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  label TEXT,
  UNIQUE (session_id, source_id, target_id)
);

CREATE INDEX idx_ideas_session ON ideas(session_id, sort_index);
CREATE INDEX idx_comments_idea ON comments(idea_id, created_at);
CREATE INDEX idx_edges_session ON edges(session_id);
```

IDs are ULIDs (sortable, URL-safe). Slugs are short nanoid strings (`n4k2p9xq`).

`visibility`:

- `unlisted` — anyone with the URL can **view**; edit requires `edit_token`
- `public` — same, but eligible for a future directory
- `token` — even view requires `view_token` in the query string or cookie

Creator receives `edit_token` once at create time; it is stored in `localStorage` under `brainstorm:session:<id>`. Sharing “can edit” means giving that token (or a dedicated edit URL).

---

## 6. Identity (v1)

No accounts.

On first visit the client generates:

```ts
{
  clientId: crypto.randomUUID(),
  displayName: "Guest"
}
```

Stored in `localStorage` (`brainstorm:identity`). `clientId` is sent as `X-Client-Id`. Display name is sent on writes and denormalized onto rows so exports stay readable if the guest later changes name.

Authorization is token-based, not identity-based:

- Read: session is `unlisted`/`public`, or request presents `view_token`
- Write: request presents `edit_token`, or `X-Client-Id` matches `owner_client_id` **and** no token was rotated

Rate-limit writes per IP with a small Durable Object or Cloudflare rate-limiting rule (`~30 req/min` for POST).

---

## 7. API

Hono app mounted at `/brainstorm/api`. JSON in/out. CORS same-origin only.

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/sessions` | Create; returns `{ session, editToken, viewToken }` |
| `GET` | `/sessions/:slug` | Full graph: session, ideas, comments, edges |
| `PATCH` | `/sessions/:slug` | Title, description, visibility (edit) |
| `POST` | `/sessions/:slug/ideas` | Create idea (`parentId` optional) |
| `PATCH` | `/sessions/:slug/ideas/:id` | Title, body, parent, color, position |
| `DELETE` | `/sessions/:slug/ideas/:id` | Cascade comments; reparent children to grandparent |
| `POST` | `/sessions/:slug/ideas/:id/comments` | Comment or reply |
| `POST` | `/sessions/:slug/edges` | Cross-link |
| `DELETE` | `/sessions/:slug/edges/:id` | |
| `GET` | `/sessions/:slug/export.md` | `Content-Disposition` attachment |
| `GET` | `/sessions/:slug/export.html` | Self-contained HTML |
| `GET` | `/health` | Deploy check |

After every successful mutation the Worker also notifies the session Durable Object so connected maps update without a refresh.

WebSocket: `GET /brainstorm/ws/:sessionId` with `Upgrade: websocket`. Query `k=` carries the view or edit token. The Worker authenticates, then `env.SESSION.get(id).fetch(request)`.

---

## 8. Real-time mind maps

One Durable Object class `SessionRoom`, id = session ULID, SQLite-backed (`new_sqlite_classes`).

**v1 behavior (enough for “share a live map”):**

- Clients on the map view open a hibernating WebSocket
- Server broadcasts `{ type, payload, actorId }` after D1 writes
- Event types: `idea.upsert`, `idea.delete`, `idea.move`, `edge.upsert`, `edge.delete`, `comment.add`, `session.patch`
- Node drags are **debounced** (local optimistic move, persist + broadcast on drag end) so D1 is not written every pointer event
- Optional lightweight `cursor` events stay in DO memory only and are not persisted

Use `ctx.acceptWebSocket()` (Hibernation API), not `ws.accept()`. Set `setWebSocketAutoResponse` for ping/pong so idle rooms hibernate.

D1 remains source of truth. The DO is a fan-out bus plus last-known graph cache so a newly connected client can `GET /sessions/:slug` or receive a `snapshot` message.

If WebSocket support slips, the map still works over HTTP (refresh / polling). Live updates are an enhancement on a correct CRUD API.

---

## 9. Mind map UX

Workspace is a split-capable screen:

- **Board** — nested idea cards, composer, comments
- **Map** — React Flow canvas of the same data
- Toolbar — view toggle, share, export, display name

Map rules:

- Each idea is a node; `parent_id` draws a tree edge; `edges` draw dashed cross-links
- Double-click canvas / selected node → new child idea
- Drag node → update `position_x/y`
- “Auto layout” runs ELK layered (or mindmap) algorithm, then writes positions
- Zoom, pan, minimap, snap-to-grid
- Selecting a node opens the idea inspector (title, body, comments) in a side panel
- Keyboard: `Enter` add sibling, `Tab` add child, `Delete` remove (with confirm)

Empty session shows a single root node titled from the session name so the map is never a blank canvas.

---

## 10. Export

Exports are derived from the same graph. Prefer generating on the Worker so a share link can offer `/export.md` without running the SPA, and also offer a client download button that hits the same endpoints.

### Markdown

Tree walk, depth → heading level (cap at `######`). Comments as blockquotes. Cross-links as a trailing “See also” list.

```markdown
# Session title

> Optional description

_Exported from https://entangleit.com/brainstorm/s/n4k2p9xq_

## Root idea

Body text.

### Child idea

Body.

> **Ada** · comment text

## See also

- [Child idea](#child-idea) → [Other idea](#other-idea)
```

### HTML

Self-contained file: inline CSS, no external JS required.

- Outline view (nested `<section>`) matching the Markdown structure
- Optional inline SVG snapshot of the map (React Flow `toObject` + simple SVG renderer, or a server-side tree layout). v1 can ship outline-only HTML and add SVG in a follow-up if snapshot quality is poor.
- `<title>` and a canonical link back to the live session

`Content-Type` and `Content-Disposition: attachment; filename="<slug>.md"` / `.html`.

---

## 11. Share model

Creating a session returns:

```
https://entangleit.com/brainstorm/s/<slug>           view (unlisted)
https://entangleit.com/brainstorm/s/<slug>?k=<edit>  edit
```

UI “Share” dialog:

- Copy view link
- Copy edit link
- Toggle “require token to view” (`visibility = token`)

Tokens are unguessable (`crypto.getRandomValues`, 18+ bytes, base64url). They are **capabilities**, not passwords — rotating `edit_token` invalidates outstanding edit links.

---

## 12. Proposed repo layout

Replace the Next.js tree. Do not keep `src/app/` (App Router) alongside Vite.

```
index.html
vite.config.ts
wrangler.jsonc
tsconfig.json
package.json
worker/
  index.ts              Hono fetch handler
  session-room.ts       Durable Object
  export.ts             MD + HTML renderers
  auth.ts               token checks
  types.ts
src/
  main.tsx
  App.tsx
  router.tsx
  lib/
    api.ts
    identity.ts
    ws.ts
  pages/
    Home.tsx
    Session.tsx
  components/
    IdeaBoard.tsx
    IdeaCard.tsx
    MindMap.tsx
    ShareDialog.tsx
    ExportMenu.tsx
migrations/
  0001_init.sql
public/
  favicon.svg
PLAN.md
README.md
```

`worker-configuration.d.ts` from `wrangler types`.

---

## 13. Worker sketch

```ts
// worker/index.ts
import { Hono } from "hono";
import { SessionRoom } from "./session-room";

export { SessionRoom };

const APP_BASE = "/brainstorm";
const app = new Hono<{ Bindings: Env }>().basePath(`${APP_BASE}/api`);

app.post("/sessions", async (c) => { /* insert session, return tokens */ });
app.get("/sessions/:slug", async (c) => { /* auth + graph */ });
// …mutations, then:
// await env.SESSION.getByName(sessionId).fetch(new Request("https://do/broadcast", { method: "POST", body }))

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith(`${APP_BASE}/api/`)) {
      return app.fetch(request, env, ctx);
    }

    if (path.startsWith(`${APP_BASE}/ws/`)) {
      const sessionId = path.slice(`${APP_BASE}/ws/`.length);
      return env.SESSION.getByName(sessionId).fetch(request);
    }

    const stripped = path === APP_BASE || path === `${APP_BASE}/`
      ? "/"
      : path.startsWith(`${APP_BASE}/`)
        ? path.slice(APP_BASE.length)
        : path;
    url.pathname = stripped;
    return env.ASSETS.fetch(new Request(url, request));
  },
};
```

Vite config:

```ts
export default defineConfig({
  base: "/brainstorm/",
  plugins: [react(), cloudflare()],
});
```

---

## 14. UI tone

Match a small EntangleIT tool, not a generic SaaS dashboard.

- Dark-first, one accent (teal/cyan on near-black)
- Inter or similar geometric sans
- Dense but readable: board is a column of cards, map is full-bleed
- Mobile: board first; map usable with pinch-zoom, inspector as bottom sheet
- Empty states with a single obvious CTA (“Add an idea”)

---

## 15. Implementation order

Build in this order so each slice is demoable at `https://entangleit.com/brainstorm`.

1. **Scaffold** — Replace Next.js with `create cloudflare --framework=react`. Set `base`, route, SPA fallback, `/brainstorm` rewrite. Deploy a hello-world page to the path.
2. **D1 + sessions API** — Create/get session, identity header, tokens.
3. **Board UI** — Home, session page, nested ideas, comments.
4. **Mind map** — React Flow bound to the same API; persist positions; auto-layout.
5. **Share** — Dialog, token query param, visibility toggle.
6. **Export** — `/export.md` and `/export.html` + toolbar download.
7. **Live updates** — `SessionRoom` DO, WebSocket, broadcast after writes.
8. **Polish** — Rate limits, empty/error states, keyboard, mobile, README.

Do not start the map or DO before the CRUD API is stable; both are views over the same tables.

---

## 16. Risks

| Risk | Mitigation |
| --- | --- |
| `/brainstorm` asset 404s because Vite `base` ≠ asset keys | Prefix-stripping Worker (section 3); verify in `vite preview` with the production base |
| Route collides with the existing EntangleIT site | Path-only route `entangleit.com/brainstorm*`; never attach a Custom Domain to this Worker |
| Zone not on the same account / not proxied | Confirm before first deploy; until then use `*.workers.dev` with the same base path |
| Edit-link leakage | Treat edit URLs as secrets; allow token rotation; default visibility `unlisted` |
| Drag-spam writes | Persist positions on drag end only; broadcast moves over WS |
| HTML export looks unlike the live map | Ship outline HTML in v1; SVG snapshot as follow-up |
| DO + D1 dual write drift | D1 commits first; broadcast only after success; clients can refetch snapshot |

---

## 17. Decisions already made

- React SPA + Worker API, not Next.js, not Pages, not React Router SSR
- Hosted under **path** `/brainstorm` on `entangleit.com`
- Session = board + mind map (one graph)
- Guest identity + capability tokens, no accounts in v1
- D1 source of truth; Durable Object for fan-out
- Markdown and HTML export from the Worker

## 18. Decisions deferred until implementation

- Exact ELK layout flavor (layered vs mindmap)
- Whether HTML export includes an SVG map in v1
- Whether `public` sessions appear on the home page
- Cloudflare account / D1 database IDs (fill in `wrangler.jsonc` at deploy time)
- Whether EntangleIT later wants Babbage identity (the unused SDK is **not** carried forward)
