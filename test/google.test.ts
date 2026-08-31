import { describe, expect, it } from "vitest";
import {
  buildSnapshot,
  driveFileName,
  parseSnapshot,
  remapSnapshot,
  SNAPSHOT_KIND,
} from "../worker/drive-snapshot";
import {
  googleAuthorizeUrl,
  googleConfigured,
  googleUserId,
  openSecret,
  sanitizeReturnTo,
  sealSecret,
  withGoogleFlag,
} from "../worker/google";
import { isGoogleUserId } from "../worker/identity";
import type { SessionGraph, WalletUser } from "../worker/types";

const owner: WalletUser = {
  id: "go_tester",
  identityKey: null,
  address: null,
  handle: "dev@example.com",
  displayName: "Dev",
  email: "dev@example.com",
  picture: null,
  isGuest: false,
  googleConnected: true,
};

const graph: SessionGraph = {
  session: {
    id: "s1",
    slug: "abcd1234",
    title: "Launch plan",
    description: "Ship it",
    visibility: "unlisted",
    owner_user_id: "go_tester",
    created_at: 1,
    updated_at: 2,
    canEdit: true,
    isOwner: true,
  },
  ideas: [
    {
      id: "root",
      session_id: "s1",
      parent_id: null,
      title: "Root",
      body: "Start",
      author_user_id: "u1",
      author_name: "Ada",
      author_address: null,
      position_x: 10,
      position_y: 20,
      color: null,
      sort_index: 0,
      vote_count: 2,
      satoshis: 0,
      created_at: 1,
      updated_at: 1,
    },
    {
      id: "child",
      session_id: "s1",
      parent_id: "root",
      title: "Child",
      body: "",
      author_user_id: "u2",
      author_name: "Bob",
      author_address: null,
      position_x: 0,
      position_y: 0,
      color: "#fff",
      sort_index: 1,
      vote_count: 0,
      satoshis: 0,
      created_at: 2,
      updated_at: 2,
    },
  ],
  comments: [
    {
      id: "c1",
      session_id: "s1",
      idea_id: "root",
      parent_id: null,
      body: "Nice",
      author_user_id: "u2",
      author_name: "Bob",
      author_address: null,
      vote_count: 0,
      satoshis: 0,
      created_at: 3,
    },
  ],
  edges: [{ id: "e1", session_id: "s1", source_id: "root", target_id: "child", label: "next" }],
  myVotes: [],
  nfts: [],
};

describe("google identity", () => {
  it("prefixes and sanitizes Google subject ids", () => {
    expect(googleUserId("108234")).toBe("go_108234");
    expect(googleUserId("abc/../x")).toBe("go_abcx");
    expect(isGoogleUserId("go_108234")).toBe(true);
    expect(isGoogleUserId("g_guest")).toBe(false);
  });

  it("requires both client id and secret", () => {
    expect(googleConfigured({} as Env)).toBe(false);
    expect(googleConfigured({ BS_GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com" } as Env)).toBe(false);
    expect(
      googleConfigured({
        BS_GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com",
        GOOGLE_CLIENT_SECRET: "secret",
      } as Env),
    ).toBe(true);
    expect(
      googleConfigured({
        GOOGLE_CLIENT_ID: "legacy.apps.googleusercontent.com",
        GOOGLE_CLIENT_SECRET: "secret",
      } as Env),
    ).toBe(true);
  });
});

describe("oauth helpers", () => {
  it("keeps return paths on /brainstorm and rejects open redirects", () => {
    expect(sanitizeReturnTo("/s/abc")).toBe("/brainstorm/s/abc");
    expect(sanitizeReturnTo("/brainstorm/s/abc?view=map")).toBe("/brainstorm/s/abc?view=map");
    expect(sanitizeReturnTo("https://evil.test/phish")).toBe("/brainstorm/");
    expect(sanitizeReturnTo("//evil.test")).toBe("/brainstorm/");
    expect(sanitizeReturnTo("/\\evil")).toBe("/brainstorm/");
    expect(withGoogleFlag("/brainstorm/s/abc")).toBe("/brainstorm/s/abc?google=connected");
    expect(withGoogleFlag("/brainstorm/s/abc?view=map")).toBe("/brainstorm/s/abc?view=map&google=connected");
  });

  it("builds a PKCE authorize URL with Drive file scope", () => {
    const url = googleAuthorizeUrl({
      clientId: "client.apps.googleusercontent.com",
      redirectUri: "https://entangleit.com/brainstorm/api/auth/google/callback",
      state: "abc",
      challenge: "challenge",
    });
    expect(url).toContain("accounts.google.com/o/oauth2/v2/auth");
    expect(url).toContain("drive.file");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain("access_type=offline");
    expect(url).toContain(encodeURIComponent("https://entangleit.com/brainstorm/api/auth/google/callback"));
  });

  it("round-trips sealed refresh tokens", async () => {
    const sealed = await sealSecret("refresh-token-value", "unit-test-key");
    expect(sealed).not.toContain("refresh-token-value");
    expect(await openSecret(sealed, "unit-test-key")).toBe("refresh-token-value");
  });
});

describe("drive snapshots", () => {
  it("serializes, parses, and remaps ids on import", () => {
    const snapshot = buildSnapshot(graph);
    expect(snapshot.kind).toBe(SNAPSHOT_KIND);
    const parsed = parseSnapshot(JSON.stringify(snapshot));
    const remapped = remapSnapshot(parsed, "new-session", owner);
    expect(remapped.ideas).toHaveLength(2);
    expect(remapped.ideas[0]?.id).not.toBe("root");
    expect(remapped.ideas[1]?.parent_id).toBe(remapped.ideas[0]?.id);
    expect(remapped.comments[0]?.idea_id).toBe(remapped.ideas[0]?.id);
    expect(remapped.edges[0]?.source_id).toBe(remapped.ideas[0]?.id);
    expect(remapped.ideas[0]?.author_user_id).toBe(owner.id);
    expect(remapped.ideas[0]?.vote_count).toBe(0);
  });

  it("rejects unknown files and sanitizes Drive names", () => {
    expect(() => parseSnapshot('{"hello":1}')).toThrow(/not a Brainstorm session/);
    expect(driveFileName('Launch: "Q3" / plan?')).toBe("Launch Q3 plan.brainstorm.json");
  });
});
