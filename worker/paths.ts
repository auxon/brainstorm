export const APP_PREFIX = "/brainstorm";

export function stripPrefix(pathname: string): string {
  if (pathname === APP_PREFIX) return "/";
  if (pathname.startsWith(`${APP_PREFIX}/`)) {
    return pathname.slice(APP_PREFIX.length) || "/";
  }
  return pathname;
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
