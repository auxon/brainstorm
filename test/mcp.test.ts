import { describe, expect, it } from "vitest";
import { handleMcp, MCP_INSTRUCTIONS, MCP_TOOLS, mcpDiscovery } from "../worker/mcp";
import { summarizeSession } from "../worker/mcp-summarize";
import { isMcpPath } from "../worker/paths";
import type { SessionGraph } from "../worker/types";

const graph: SessionGraph = {
  session: {
    id: "s",
    slug: "abc12345",
    title: "Widget launch",
    description: "How we ship",
    visibility: "unlisted",
    owner_user_id: "u1",
    created_at: 1,
    updated_at: 2,
    canEdit: true,
    isOwner: false,
  },
  ideas: [
    {
      id: "root",
      session_id: "s",
      parent_id: null,
      title: "Root idea",
      body: "Start here",
      author_user_id: "u1",
      author_name: "Ada",
      author_address: null,
      position_x: 0,
      position_y: 0,
      color: null,
      sort_index: 0,
      vote_count: 3,
      satoshis: 100,
      created_at: 1,
      updated_at: 1,
    },
    {
      id: "child",
      session_id: "s",
      parent_id: "root",
      title: "Child idea",
      body: "A".repeat(400),
      author_user_id: "u2",
      author_name: "Bob",
      author_address: null,
      position_x: 0,
      position_y: 0,
      color: null,
      sort_index: 0,
      vote_count: 1,
      satoshis: 0,
      created_at: 2,
      updated_at: 2,
    },
  ],
  comments: [
    {
      id: "c1",
      session_id: "s",
      idea_id: "root",
      parent_id: null,
      body: "Love this",
      author_user_id: "u2",
      author_name: "Bob",
      author_address: null,
      vote_count: 2,
      satoshis: 10,
      created_at: 3,
    },
  ],
  edges: [{ id: "e1", session_id: "s", source_id: "root", target_id: "child", label: "leads to" }],
  myVotes: [{ targetType: "idea", targetId: "root", satoshis: 100 }],
  nfts: [],
};

describe("isMcpPath", () => {
  it("matches the prefixed and bare MCP routes", () => {
    expect(isMcpPath("/brainstorm/mcp")).toBe(true);
    expect(isMcpPath("/brainstorm/mcp/")).toBe(true);
    expect(isMcpPath("/mcp")).toBe(true);
    expect(isMcpPath("/brainstorm/api/health")).toBe(false);
    expect(isMcpPath("/brainstorm/s/abc")).toBe(false);
  });
});

describe("summarizeSession", () => {
  it("returns a compact outline with the public session URL", () => {
    const summary = summarizeSession(graph);
    expect(summary.url).toBe("https://entangleit.com/brainstorm/s/abc12345");
    expect(summary.session.ideaCount).toBe(2);
    expect(summary.session.commentCount).toBe(1);
    expect(summary.ideas.map((i) => i.title)).toEqual(["Root idea", "Child idea"]);
    expect(summary.ideas[0]?.comments?.[0]?.body).toBe("Love this");
    expect(summary.ideas[1]?.body?.endsWith("…")).toBe(true);
    expect(summary.ideas[1]?.body?.length).toBeLessThan(400);
    expect(JSON.stringify(summary)).not.toContain("position_x");
  });
});

describe("mcpDiscovery", () => {
  it("lists the public tools", () => {
    const doc = mcpDiscovery();
    expect(doc.endpoint).toBe("https://entangleit.com/brainstorm/mcp");
    expect(doc.tools).toEqual([...MCP_TOOLS]);
    expect(MCP_INSTRUCTIONS).toContain("yours-agent");
  });
});

function fakeEnv(): Env {
  return {} as Env;
}

function fakeCtx(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
}

async function parseMcpBody(res: Response): Promise<unknown> {
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (ct.includes("application/json")) return JSON.parse(text) as unknown;
  const data = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean)
    .at(-1);
  if (data) return JSON.parse(data) as unknown;
  return JSON.parse(text) as unknown;
}

describe("handleMcp", () => {
  it("serves a discovery document on GET", async () => {
    const res = await handleMcp(
      new Request("https://entangleit.com/brainstorm/mcp"),
      fakeEnv(),
      fakeCtx(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tools: string[]; transport: string };
    expect(body.transport).toBe("streamable-http");
    expect(body.tools).toContain("idea_post");
  });

  it("answers a legacy initialize handshake", async () => {
    const res = await handleMcp(
      new Request("https://entangleit.com/brainstorm/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "vitest", version: "0" },
          },
        }),
      }),
      fakeEnv(),
      fakeCtx(),
    );
    expect(res.ok).toBe(true);
    const rpc = (await parseMcpBody(res)) as {
      result?: { serverInfo?: { name: string }; instructions?: string };
      error?: { message: string };
    };
    expect(rpc.error).toBeUndefined();
    expect(rpc.result?.serverInfo?.name).toBe("brainstorm");
    expect(rpc.result?.instructions).toContain("site wallet");
  });

  it("lists the registered tools", async () => {
    const res = await handleMcp(
      new Request("https://entangleit.com/brainstorm/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        }),
      }),
      fakeEnv(),
      fakeCtx(),
    );
    expect(res.ok).toBe(true);
    const rpc = (await parseMcpBody(res)) as {
      result?: { tools?: { name: string }[] };
      error?: unknown;
    };
    expect(rpc.error).toBeUndefined();
    const names = (rpc.result?.tools ?? []).map((t) => t.name).sort();
    expect(names).toEqual([...MCP_TOOLS].sort());
  });
});
