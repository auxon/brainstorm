# Brainstorm

Collaborative idea boards and mind maps at
[https://entangleit.com/brainstorm](https://entangleit.com/brainstorm).

Create a session, post nested ideas, comment, **upvote**, export Markdown or
HTML, and share the mind map by URL. **No browser wallet is required.** The
first write mints a guest identity (cookie). **Archive** ($9/month via Stripe)
lets you mint a session as a **1Sat Ordinal NFT**; the **site wallet** (Worker
secret, funded with BSV) inscribes it. Yours Wallet is optional: humans can
link it for a BSV identity and sat boosts, and agents can use
[yours-agent](https://github.com/auxon/yours-agent) as the operator treasury.

Architecture notes live in [PLAN.md](./PLAN.md).

## Stack

- React 19 + Vite + TypeScript SPA (`base: /brainstorm/`)
- Cloudflare Worker (Hono) on routes `entangleit.com/brainstorm` and `…/brainstorm/*`
- D1 for sessions, ideas, comments, votes, guest/wallet sessions, and billing
- Durable Objects + WebSocket hibernation for live maps
- `@xyflow/react` canvas
- `@bsv/sdk` + `@1sat/templates` for site-wallet 1Sat inscriptions
- Optional `@1sat/react` + `@1sat/actions` for sat boosts
- MCP (`@modelcontextprotocol/server` v2 + `agents/mcp/server`) at `/brainstorm/mcp`

## Local development

```bash
npm install
npx wrangler d1 migrations apply brainstorm --local
npm run dev
```

Open [http://localhost:5173/brainstorm/](http://localhost:5173/brainstorm/).
Viewing, creating, voting, and Archive checkout work without a wallet.

```bash
npm test
npm run typecheck
```

## MCP (agents)

Brainstorm exposes a **stateless Streamable HTTP** MCP server so agents can create
sessions, post nested ideas, comment, vote, subscribe via Stripe Checkout URLs,
and mint NFTs through the site wallet.

**Endpoint:** [https://entangleit.com/brainstorm/mcp](https://entangleit.com/brainstorm/mcp)

Writes do **not** require Yours. `session_create` without a token mints a guest
identity and returns `token` + `editToken`. Pass `editToken` on later writes.

Optional BSV identity (site agent / sat boosts) — pair
[yours-agent](https://github.com/auxon/yours-agent):

1. `auth_challenge`
2. yours-agent `sign_message` on the challenge (identity key)
3. `auth_verify` with `nonce`, `message`, `sig`, and `pubKey`
4. Pass the returned `token` on write tools

Sat boosts from a personal wallet: `send_bsv` then `vote` with `satoshis` and
`txid`. NFT mints use `nft_mint` (site wallet), not a browser extension.

### Cursor (remote MCP)

Settings → MCP → add a remote server with URL:

```
https://entangleit.com/brainstorm/mcp
```

Or in `mcp.json`:

```json
{
  "mcpServers": {
    "brainstorm": {
      "url": "https://entangleit.com/brainstorm/mcp"
    }
  }
}
```

`GET` on that URL returns a discovery document (tool names and pairing notes).
`POST` is JSON-RPC Streamable HTTP.

## Archive (Stripe + site-wallet NFT)

[Brainstorm Archive](https://entangleit.com/brainstorm/billing) is **$9/month**.
Subscribe in Stripe Checkout (guest cookie is enough). An active subscription
unlocks **Mint NFT**: the Worker snapshots the board to Markdown and the **site
wallet** inscribes it as a 1Sat Ordinal. Origin/txid are stored on the session.

- Checkout: Stripe-hosted Checkout (`mode: subscription`). No
  `payment_method_types` (dynamic methods).
- Customer portal for cancel / card update.
- Webhook: `POST /brainstorm/api/billing/webhook`
- Secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SITE_WALLET_WIF`
  (Wrangler). Price id and publishable key are Worker `vars`.
- Fund the site address shown on `/billing` (WhatsOnChain). yours-agent
  `send_bsv` is the intended operator path.

Do **not** enable Stripe Tax `automatic_tax` until the Dashboard has an active
tax registration for each jurisdiction you sell into. Until then, Checkout
collects the list price only. See
[Collect taxes for recurring payments](https://docs.stripe.com/billing/taxes/collect-taxes).

Never commit or print `SITE_WALLET_WIF` or Stripe secret keys.

## Deploy

Create the D1 database once, paste its id into `wrangler.jsonc`, then:

```bash
npx wrangler d1 create brainstorm
npm run deploy
```

The Worker is path-routed so it does **not** take over `entangleit.com`. Fill in
a real `database_id` before the first remote deploy.
