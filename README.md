# Brainstorm

Collaborative idea boards and mind maps at
[https://entangleit.com/brainstorm](https://entangleit.com/brainstorm).

Sign in with **Yours Wallet** (same BRC-100 challenge flow as
[SatPress](https://github.com/EntangleIT/satpress)): connect the extension,
approve a sign-in message, and your compressed pubkey becomes your identity.
From there you can create sessions, post nested ideas, comment, **upvote**, and
optionally **boost with sats** paid to the author's BSV address. Sessions export
to Markdown or a self-contained HTML file, and the mind map is shareable by URL.

Architecture notes live in [PLAN.md](./PLAN.md). Auth and upvotes were added on
top of that plan to match SatPress.

## Stack

- React 19 + Vite + TypeScript SPA (`base: /brainstorm/`)
- Cloudflare Worker (Hono) on routes `entangleit.com/brainstorm` and `…/brainstorm/*`
- D1 for sessions, ideas, comments, votes, and wallet sessions
- Durable Objects + WebSocket hibernation for live maps
- `@xyflow/react` canvas
- `@1sat/react` + `@1sat/actions` + `@bsv/sdk` for Yours Wallet

## Local development

```bash
npm install
npx wrangler d1 migrations apply brainstorm --local
npm run dev
```

Open [http://localhost:5173/brainstorm/](http://localhost:5173/brainstorm/).
Yours Wallet is a Chrome extension — install it from
[yours.org](https://yours.org) to sign in and upvote. Viewing a shared session
does not require a wallet.

```bash
npm test
npm run typecheck
```

## Deploy

Create the D1 database once, paste its id into `wrangler.jsonc`, then:

```bash
npx wrangler d1 create brainstorm
npm run deploy
```

The Worker is path-routed so it does **not** take over `entangleit.com`. Fill in
a real `database_id` before the first remote deploy.
