import { describe, expect, it } from "vitest";
import { renderHtml, renderMarkdown, type ExportGraph } from "../worker/export";

const graph: ExportGraph = {
  session: { slug: "abc12345", title: "Widget launch", description: "How we ship" },
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
      body: "",
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
};

describe("export", () => {
  it("renders markdown outline with votes and comments", () => {
    const md = renderMarkdown(graph);
    expect(md).toContain("# Widget launch");
    expect(md).toContain("## Root idea");
    expect(md).toContain("### Child idea");
    expect(md).toContain("3 ↑");
    expect(md).toContain("100 sats");
    expect(md).toContain("**Bob**");
    expect(md).toContain("Love this");
    expect(md).toContain("/brainstorm/s/abc12345");
    expect(md).toContain("See also");
  });

  it("renders a self-contained HTML document", () => {
    const html = renderHtml(graph);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Widget launch");
    expect(html).toContain("Love this");
    expect(html).toContain("100 sats");
  });
});
