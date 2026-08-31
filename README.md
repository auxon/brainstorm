# Brainstorm

Collaborative idea boards and mind maps, hosted at
[https://entangleit.com/brainstorm](https://entangleit.com/brainstorm).

Post ideas, discuss them in threads, arrange them as a shareable mind map, and
export a session to Markdown or a self-contained HTML file.

This repository is currently a Next.js 14 starter. It will be replaced with a
**React + Vite + Cloudflare Workers** app. The architecture, data model, URL
map, and implementation order are in [PLAN.md](./PLAN.md).

## Stack (planned)

- React 19 + Vite + TypeScript SPA (`base: /brainstorm/`)
- Cloudflare Worker API (Hono) on route `entangleit.com/brainstorm*`
- D1 for sessions, ideas, comments
- Durable Objects + WebSocket hibernation for live maps
- `@xyflow/react` for the canvas

## Local development (after scaffold)

```bash
npm install
npm run dev
```

The SPA and Worker run together through `@cloudflare/vite-plugin`. Production
deploy:

```bash
npm run deploy
```

That publishes to the `/brainstorm` path on `entangleit.com` without taking over
the rest of the zone. See [PLAN.md](./PLAN.md) §3 for the prefix-rewrite
details.
