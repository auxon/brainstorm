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
- MCP (`@modelcontextprotocol/server` v2 + `agents/mcp/server`) at `/brainstorm/mcp`

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

## MCP (agents)

Brainstorm exposes a **stateless Streamable HTTP** MCP server so agents can create
sessions, post nested ideas, comment, vote or record sat boosts, and export
Markdown/HTML without the UI.

**Endpoint:** [https://entangleit.com/brainstorm/mcp](https://entangleit.com/brainstorm/mcp)

Writes still require **Yours Wallet** identity (the same BSM challenge as the
website). Pair with [yours-agent](https://github.com/auxon/yours-agent):

1. `auth_challenge`
2. yours-agent `sign_message` on the challenge (identity key)
3. `auth_verify` with `nonce`, `message`, `sig`, and `pubKey`
4. Pass the returned `token` on write tools
5. `session_create` returns `editToken` **once** — store it and pass it as
   `editToken` when posting to that board

Sat boosts: send BSV with yours-agent `send_bsv`, then call `vote` with
`satoshis` and `txid`. The MCP server never broadcasts a payment itself.

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

## Deploy

Create the D1 database once, paste its id into `wrangler.jsonc`, then:

```bash
npx wrangler d1 create brainstorm
npm run deploy
```

The Worker is path-routed so it does **not** take over `entangleit.com`. Fill in
a real `database_id` before the first remote deploy.
