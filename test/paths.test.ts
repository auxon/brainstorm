import { describe, expect, it } from "vitest";
import {
  APP_PREFIX,
  isRootAssetRedirect,
  stripPrefix,
  toAssetPath,
} from "../worker/paths";

describe("stripPrefix", () => {
  it("maps the app prefix to /", () => {
    expect(stripPrefix(APP_PREFIX)).toBe("/");
    expect(stripPrefix(`${APP_PREFIX}/`)).toBe("/");
  });

  it("strips nested paths", () => {
    expect(stripPrefix(`${APP_PREFIX}/login`)).toBe("/login");
    expect(stripPrefix(`${APP_PREFIX}/assets/app.js`)).toBe("/assets/app.js");
  });
});

describe("toAssetPath", () => {
  it("serves index.html for the app root", () => {
    expect(toAssetPath(`${APP_PREFIX}/`)).toBe("/index.html");
    expect(toAssetPath(APP_PREFIX)).toBe("/index.html");
  });

  it("keeps hashed assets and SPA routes", () => {
    expect(toAssetPath(`${APP_PREFIX}/assets/index-abc.js`)).toBe("/assets/index-abc.js");
    expect(toAssetPath(`${APP_PREFIX}/login`)).toBe("/login");
  });
});

describe("isRootAssetRedirect", () => {
  it("detects /index.html pretty-URL redirects", () => {
    expect(isRootAssetRedirect("/", "https://entangleit.com")).toBe(true);
    expect(isRootAssetRedirect("/index.html", "https://entangleit.com")).toBe(true);
  });

  it("ignores unrelated redirects", () => {
    expect(isRootAssetRedirect("/login", "https://entangleit.com")).toBe(false);
  });
});
