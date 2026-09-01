/**
 * Remote Brainstorm MCP — Streamable HTTP at /brainstorm/mcp.
 *
 * Tools call the existing Hono API in-process (synthetic Request + Bearer /
 * X-Token) so validation, auth, and broadcasts stay in one place.
 *
 * Humans on the website do not need Yours Wallet. Agents can:
 *   - skip pairing: session_create mints a guest identity and returns `token`
 *   - or pair yours-agent (site wallet / BSV identity):
 *       auth_challenge → sign_message (identity) → auth_verify
 * session_create returns editToken once; pass it on later writes.
 */
import { createMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { api } from "./api";
import { APP_PREFIX, isMcpPath } from "./paths";
import { PUBLIC_SITE, sessionUrl, summarizeSession } from "./mcp-summarize";
import type { SessionGraph } from "./types";

export const MCP_NAME = "brainstorm";
export const MCP_VERSION = "0.1.0";

export const MCP_TOOLS = [
  "health",
  "auth_challenge",
  "auth_verify",
  "me",
  "session_get",
  "session_create",
  "session_update",
  "idea_post",
  "idea_comment",
  "vote",
  "export_session",
  "explore",
  "billing_status",
  "billing_checkout",
  "billing_feature",
  "billing_boost",
  "nft_prepare",
  "nft_mint",
  "nft_record",
] as const;

export const MCP_INSTRUCTIONS = [
  "Brainstorm is a collaborative idea board and mind map.",
  "Public UI: https://entangleit.com/brainstorm/",
  "Humans do not need Yours Wallet. Guest cookies / session_create tokens are enough for boards, votes, Stripe Archive, and NFT mints.",
  "Google sign-in and Drive save/load are browser OAuth flows (drive.file). Agents keep using session tokens; they do not receive Google refresh tokens.",
  "Yours is optional and server-side: pair yours-agent only if this agent should use the site BSV identity (sat boosts, funding the treasury).",
  "Pairing: 1) auth_challenge 2) yours-agent sign_message on the challenge 3) auth_verify 4) pass token on write tools.",
  "Or skip pairing: session_create without token mints a guest identity and returns token + editToken.",
  "session_create returns editToken once — store it and pass as editToken to post ideas.",
  "The session owner may omit editToken. View-only session_get does not need a token for unlisted/public boards.",
  "vote records an upvote. Sat boosts from a personal wallet still use yours-agent send_bsv then vote with satoshis and txid.",
  "USD boosts ($1 / $3 / $5) use billing_boost — Stripe Checkout URL, platform keeps USD. Do not drain the site wallet to pay authors.",
  "Featured boards ($29 / 7 days) use billing_feature (edit access required). explore lists featured + public boards.",
  "Archive ($9/mo Stripe) unlocks minting. billing_checkout returns a Checkout URL (human pays in a browser). nft_mint inscribes via the Brainstorm site wallet — do not use Yours in the browser.",
].join("\n");

type ToolResult = {
  isError?: boolean;
  content: { type: "text"; text: string }[];
};

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(status: number, json: unknown, text?: string): ToolResult {
  const error =
    json && typeof json === "object" && "error" in json
      ? String((json as { error: unknown }).error)
      : text?.slice(0, 300) || `HTTP ${status}`;
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ status, error }) }],
  };
}

function isGraph(value: unknown): value is SessionGraph {
  return Boolean(value && typeof value === "object" && "session" in value && "ideas" in value);
}

function graphOk(status: number, json: unknown, extra?: Record<string, unknown>): ToolResult {
  if (status >= 400) return fail(status, json);
  if (!isGraph(json)) return ok(extra ? { ...extra, result: json } : json);
  const summary = summarizeSession(json);
  return ok(extra ? { ...extra, ...summary } : summary);
}

async function apiCall(
  env: Env,
  ctx: ExecutionContext,
  origin: string,
  method: string,
  path: string,
  opts: { token?: string; editToken?: string; body?: unknown } = {},
): Promise<{ status: number; json: unknown; text: string }> {
  const headers = new Headers({ accept: "application/json, text/markdown, text/html" });
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  if (opts.token) headers.set("authorization", `Bearer ${opts.token}`);
  if (opts.editToken) headers.set("x-token", opts.editToken);
  const req = new Request(`${origin}${APP_PREFIX}/api${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const res = await api.fetch(req, env, ctx);
  const text = await res.text();
  const ct = res.headers.get("content-type") ?? "";
  let json: unknown = null;
  if (ct.includes("json") && text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = { raw: text };
    }
  }
  return { status: res.status, json, text };
}

const tokenField = z.string().describe("Session token from auth_verify (Authorization Bearer).");
const editTokenField = z
  .string()
  .optional()
  .describe("Write capability from session_create. Owners can omit this.");
const slugField = z.string().describe("Session slug, e.g. 4kpoxomx");

export function createBrainstormMcpServer(env: Env, ctx: ExecutionContext, origin: string): McpServer {
  const server = new McpServer(
    { name: MCP_NAME, version: MCP_VERSION },
    { instructions: MCP_INSTRUCTIONS },
  );

  const call = (
    method: string,
    path: string,
    opts?: { token?: string; editToken?: string; body?: unknown },
  ) => apiCall(env, ctx, origin, method, path, opts);

  server.registerTool(
    "health",
    {
      title: "Health",
      description: "Check that Brainstorm API and MCP are up.",
    },
    async () => {
      const { status, json } = await call("GET", "/health");
      if (status >= 400) return fail(status, json);
      return ok({
        ok: true,
        service: "brainstorm-mcp",
        site: `${PUBLIC_SITE}/`,
        mcp: `${PUBLIC_SITE}/mcp`,
        api: json,
      });
    },
  );

  server.registerTool(
    "auth_challenge",
    {
      title: "Auth challenge",
      description:
        "Start Yours Wallet sign-in. Sign the returned message with yours-agent sign_message (identity key), then call auth_verify.",
      inputSchema: z.object({
        origin: z
          .string()
          .optional()
          .describe("Origin bound into the challenge. Defaults to https://entangleit.com"),
      }),
    },
    async ({ origin: challengeOrigin }) => {
      const { status, json } = await call("POST", "/wallet-auth/challenge", {
        body: { origin: challengeOrigin || "https://entangleit.com" },
      });
      if (status >= 400) return fail(status, json);
      return ok({
        ...((json as object) ?? {}),
        next: "Call yours-agent sign_message with this message, then auth_verify.",
      });
    },
  );

  server.registerTool(
    "auth_verify",
    {
      title: "Auth verify",
      description:
        "Exchange a BSM signature of the challenge for a session token. pubKey is the compressed identity pubkey (yours-agent get_public_key). Keep the token for later tools; do not paste it into public chats.",
      inputSchema: z.object({
        nonce: z.string(),
        message: z.string(),
        sig: z.string().describe("Compact base64 BSM signature from sign_message"),
        pubKey: z.string().describe("Compressed pubkey hex that verifies the signature"),
        identityKey: z.string().optional(),
        address: z.string().optional().describe("BSV address, used for sat boosts"),
      }),
    },
    async ({ nonce, message, sig, pubKey, identityKey, address }) => {
      const { status, json } = await call("POST", "/wallet-auth/verify", {
        body: { nonce, message, sig, pubKey, identityKey, address },
      });
      if (status >= 400) return fail(status, json);
      const body = json as { token?: string; user?: unknown; id?: string };
      return ok({
        token: body.token,
        user: body.user ?? { id: body.id },
        note: "Pass token as `token` on write tools. It is also set as a cookie for browsers.",
      });
    },
  );

  server.registerTool(
    "me",
    {
      title: "Who am I",
      description: "Return the wallet user for a session token, or null if unsigned.",
      inputSchema: z.object({ token: tokenField.optional() }),
    },
    async ({ token }) => {
      const { status, json } = await call("GET", "/wallet-auth/session", { token });
      if (status >= 400) return fail(status, json);
      return ok(json);
    },
  );

  server.registerTool(
    "session_get",
    {
      title: "Get session",
      description: "Load a compact outline of a session (ideas, votes, comments, share URL).",
      inputSchema: z.object({
        slug: slugField,
        token: tokenField.optional(),
        editToken: editTokenField,
      }),
    },
    async ({ slug, token, editToken }) => {
      const { status, json } = await call("GET", `/sessions/${encodeURIComponent(slug)}`, {
        token,
        editToken,
      });
      return graphOk(status, json);
    },
  );

  server.registerTool(
    "session_create",
    {
      title: "Create session",
      description:
        "Create a brainstorm session. Token is optional — omitted mints a guest identity (no Yours Wallet). Returns editToken once — store it; it is the write capability for this board.",
      inputSchema: z.object({
        token: tokenField.optional(),
        title: z.string().min(1),
        description: z.string().optional(),
      }),
    },
    async ({ token, title, description }) => {
      const { status, json } = await call("POST", "/sessions", {
        token,
        body: { title, description: description ?? "" },
      });
      if (status >= 400) return fail(status, json);
      const created = json as {
        session?: { slug?: string };
        editToken?: string;
        viewToken?: string;
        ideas?: unknown;
      };
      const slug = created.session?.slug;
      const graph = json as SessionGraph & { editToken?: string; viewToken?: string };
      return graphOk(status, graph, {
        editToken: created.editToken,
        viewToken: created.viewToken,
        token: (json as { token?: string }).token,
        url: slug ? sessionUrl(slug) : undefined,
        note: "Save editToken (write capability) and token (guest/session identity). editToken is only returned here.",
      });
    },
  );

  server.registerTool(
    "session_update",
    {
      title: "Update session",
      description: "Patch title, description, or visibility (unlisted | public | token).",
      inputSchema: z.object({
        slug: slugField,
        token: tokenField.optional(),
        editToken: editTokenField,
        title: z.string().optional(),
        description: z.string().optional(),
        visibility: z.enum(["unlisted", "public", "token"]).optional(),
      }),
    },
    async ({ slug, token, editToken, title, description, visibility }) => {
      const { status, json } = await call("PATCH", `/sessions/${encodeURIComponent(slug)}`, {
        token,
        editToken,
        body: { title, description, visibility },
      });
      return graphOk(status, json);
    },
  );

  server.registerTool(
    "idea_post",
    {
      title: "Post idea",
      description: "Add a nested idea to a session. parentId omitted attaches under the root. Token optional when a guest/session cookie or prior session_create token is used; pass editToken.",
      inputSchema: z.object({
        slug: slugField,
        token: tokenField.optional(),
        editToken: editTokenField,
        title: z.string().min(1),
        body: z.string().optional(),
        parentId: z.string().optional().describe("Parent idea id. Omit for a top-level child of the root."),
      }),
    },
    async ({ slug, token, editToken, title, body, parentId }) => {
      const { status, json } = await call("POST", `/sessions/${encodeURIComponent(slug)}/ideas`, {
        token,
        editToken,
        body: { title, body: body ?? "", parentId: parentId ?? null },
      });
      return graphOk(status, json, { postedTitle: title });
    },
  );

  server.registerTool(
    "idea_comment",
    {
      title: "Comment on idea",
      description: "Comment on an idea. Requires edit access. Token optional (guest identity is minted when omitted).",
      inputSchema: z.object({
        slug: slugField,
        token: tokenField.optional(),
        editToken: editTokenField,
        ideaId: z.string(),
        body: z.string().min(1),
        parentId: z.string().optional().describe("Parent comment id for a thread reply"),
      }),
    },
    async ({ slug, token, editToken, ideaId, body, parentId }) => {
      const { status, json } = await call(
        "POST",
        `/sessions/${encodeURIComponent(slug)}/ideas/${encodeURIComponent(ideaId)}/comments`,
        { token, editToken, body: { body, parentId: parentId ?? null } },
      );
      return graphOk(status, json);
    },
  );

  server.registerTool(
    "vote",
    {
      title: "Vote or boost",
      description:
        "Upvote an idea or comment. For a sat boost, first send BSV with yours-agent send_bsv to the author, then pass satoshis and txid here. Do not send BSV from this tool. Calling vote again without satoshis toggles the upvote off.",
      inputSchema: z.object({
        slug: slugField,
        token: tokenField.optional(),
        targetType: z.enum(["idea", "comment"]),
        targetId: z.string(),
        satoshis: z.number().int().min(0).optional(),
        txid: z.string().optional(),
      }),
    },
    async ({ slug, token, targetType, targetId, satoshis, txid }) => {
      const { status, json } = await call("POST", `/sessions/${encodeURIComponent(slug)}/votes`, {
        token,
        body: { targetType, targetId, satoshis: satoshis ?? 0, txid: txid ?? null },
      });
      return graphOk(status, json);
    },
  );

  server.registerTool(
    "export_session",
    {
      title: "Export session",
      description: "Export a session as Markdown or a self-contained HTML document.",
      inputSchema: z.object({
        slug: slugField,
        format: z.enum(["markdown", "html"]).optional(),
        token: tokenField.optional(),
        editToken: editTokenField,
      }),
    },
    async ({ slug, format, token, editToken }) => {
      const ext = format === "html" ? "html" : "md";
      const { status, json, text } = await call(
        "GET",
        `/sessions/${encodeURIComponent(slug)}/export.${ext}`,
        { token, editToken },
      );
      if (status >= 400) return fail(status, json, text);
      return { content: [{ type: "text", text }] };
    },
  );

  server.registerTool(
    "explore",
    {
      title: "Explore public boards",
      description: "List featured ($29 / 7 days) and recent public boards.",
      inputSchema: z.object({}),
    },
    async () => {
      const { status, json } = await call("GET", "/explore");
      if (status >= 400) return fail(status, json);
      return ok(json);
    },
  );

  server.registerTool(
    "billing_status",
    {
      title: "Billing status",
      description: "Show Archive subscription status for the current wallet token ($9/mo Stripe → NFT minting).",
      inputSchema: z.object({ token: tokenField.optional() }),
    },
    async ({ token }) => {
      const { status, json } = await call("GET", "/billing/status", { token });
      if (status >= 400) return fail(status, json);
      return ok(json);
    },
  );

  server.registerTool(
    "billing_checkout",
    {
      title: "Stripe Checkout",
      description:
        "Create a Stripe Checkout URL for Brainstorm Archive. A human must complete payment in the browser. Token optional — a guest identity is minted when omitted.",
      inputSchema: z.object({ token: tokenField.optional() }),
    },
    async ({ token }) => {
      const { status, json } = await call("POST", "/billing/checkout", { token });
      if (status >= 400) return fail(status, json);
      return ok(json);
    },
  );

  server.registerTool(
    "billing_feature",
    {
      title: "Feature board Checkout",
      description:
        "Create a Stripe Checkout URL ($29) to pin a board on /explore for 7 days. Requires edit access. A human must complete payment in the browser. Makes the board public.",
      inputSchema: z.object({
        slug: slugField,
        token: tokenField.optional(),
        editToken: editTokenField,
      }),
    },
    async ({ slug, token, editToken }) => {
      const { status, json } = await call("POST", "/billing/feature", {
        token,
        editToken,
        body: { slug },
      });
      if (status >= 400) return fail(status, json);
      return ok(json);
    },
  );

  server.registerTool(
    "billing_boost",
    {
      title: "USD boost Checkout",
      description:
        "Create a Stripe Checkout URL for a $1, $3, or $5 idea/comment boost. Platform keeps USD. A human must complete payment in the browser. Token optional.",
      inputSchema: z.object({
        slug: slugField,
        token: tokenField.optional(),
        targetType: z.enum(["idea", "comment"]),
        targetId: z.string(),
        usd: z.number().describe("$1, $3, or $5"),
      }),
    },
    async ({ slug, token, targetType, targetId, usd }) => {
      const { status, json } = await call("POST", "/billing/boost", {
        token,
        body: { slug, targetType, targetId, usd },
      });
      if (status >= 400) return fail(status, json);
      return ok(json);
    },
  );

  server.registerTool(
    "nft_prepare",
    {
      title: "Prepare NFT inscription",
      description:
        "Return the Markdown snapshot and sha256. Requires Archive and edit access. Prefer nft_mint (site wallet) over inscribing in a browser wallet.",
      inputSchema: z.object({
        slug: slugField,
        token: tokenField.optional(),
        editToken: editTokenField,
      }),
    },
    async ({ slug, token, editToken }) => {
      const { status, json } = await call("POST", `/sessions/${encodeURIComponent(slug)}/nft/prepare`, {
        token,
        editToken,
      });
      if (status >= 400) return fail(status, json);
      return ok(json);
    },
  );

  server.registerTool(
    "nft_mint",
    {
      title: "Mint NFT (site wallet)",
      description:
        "Inscribe the session Markdown as a 1Sat Ordinal using the Brainstorm site wallet. Requires Archive + edit access. Does not use Yours Wallet in the browser.",
      inputSchema: z.object({
        slug: slugField,
        token: tokenField.optional(),
        editToken: editTokenField,
      }),
    },
    async ({ slug, token, editToken }) => {
      const { status, json } = await call("POST", `/sessions/${encodeURIComponent(slug)}/nft/mint`, {
        token,
        editToken,
      });
      return graphOk(status, json);
    },
  );

  server.registerTool(
    "nft_record",
    {
      title: "Record minted NFT",
      description: "Store a 1Sat inscription txid/origin if you inscribed outside the site wallet.",
      inputSchema: z.object({
        slug: slugField,
        token: tokenField.optional(),
        editToken: editTokenField,
        txid: z.string().describe("64-char hex transaction id"),
        origin: z.string().optional(),
        contentHash: z.string().optional(),
      }),
    },
    async ({ slug, token, editToken, txid, origin, contentHash }) => {
      const { status, json } = await call("POST", `/sessions/${encodeURIComponent(slug)}/nft`, {
        token,
        editToken,
        body: { txid, origin, contentHash },
      });
      return graphOk(status, json);
    },
  );

  server.registerPrompt(
    "wallet_pairing",
    {
      title: "Yours Wallet pairing",
      description: "How an MCP agent signs into Brainstorm with yours-agent.",
    },
    () => ({
      messages: [
        {
          role: "user" as const,
          content: { type: "text" as const, text: MCP_INSTRUCTIONS },
        },
      ],
    }),
  );

  return server;
}

export function mcpDiscovery(): Record<string, unknown> {
  return {
    name: MCP_NAME,
    version: MCP_VERSION,
    transport: "streamable-http",
    endpoint: `${PUBLIC_SITE}/mcp`,
    site: `${PUBLIC_SITE}/`,
    tools: [...MCP_TOOLS],
    auth: "Guest sessions by default. Optional Yours BSM via yours-agent for a site BSV identity.",
  };
}

function rewriteMcpUrl(request: Request): Request {
  const url = new URL(request.url);
  url.pathname = "/mcp";
  return new Request(url, request);
}

export async function handleMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const rewritten = isMcpPath(new URL(request.url).pathname) ? rewriteMcpUrl(request) : request;

  if (rewritten.method === "GET") {
    return Response.json(mcpDiscovery(), {
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
      },
    });
  }

  const handler = createMcpHandler(() => createBrainstormMcpServer(env, ctx, new URL(request.url).origin), {
    route: "/mcp",
    allowedOriginHostnames: "*",
    onerror: (error) => {
      console.error("[mcp]", error);
    },
  });
  return handler(rewritten, env, ctx);
}

