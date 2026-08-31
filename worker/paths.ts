export const APP_PREFIX = "/brainstorm";

export function stripPrefix(pathname: string): string {
  if (pathname === APP_PREFIX) return "/";
  if (pathname.startsWith(`${APP_PREFIX}/`)) {
    return pathname.slice(APP_PREFIX.length) || "/";
  }
  return pathname;
}

/** Path to fetch from the ASSETS binding after stripping /brainstorm. */
export function toAssetPath(pathname: string): string {
  const inner = stripPrefix(pathname);
  if (inner === "/" || inner === "") return "/index.html";
  return inner;
}

/**
 * True when ASSETS html_handling redirected /index.html to the site root.
 * The Worker must follow that internally — a Location: / on the custom domain
 * would send the browser to the apex site instead of this app.
 */
export function isRootAssetRedirect(location: string, origin: string): boolean {
  try {
    const next = new URL(location, origin);
    return next.pathname === "/" || next.pathname === "/index.html";
  } catch {
    return false;
  }
}

/** True for the Streamable HTTP MCP endpoint (`/mcp` or `/brainstorm/mcp`). */
export function isMcpPath(pathname: string): boolean {
  const inner = stripPrefix(pathname).replace(/\/+$/, "") || "/";
  return inner === "/mcp";
}

export function isViteDevPath(pathname: string): boolean {
  return (
    pathname.startsWith("/@") ||
    pathname.startsWith("/src/") ||
    pathname.startsWith("/node_modules/") ||
    pathname.startsWith("/.vite/")
  );
}

export function isStaticAsset(pathname: string): boolean {
  return (
    isViteDevPath(pathname) ||
    pathname.startsWith("/assets/") ||
    pathname === "/favicon.svg" ||
    pathname === "/favicon.ico" ||
    /\.(?:js|css|map|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|json|txt|mjs|wasm|tsx?|jsx?)$/i.test(
      pathname,
    )
  );
}
