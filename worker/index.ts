/**
 * Brainstorm Worker — mounted at /brainstorm on entangleit.com.
 *
 * Production assets live at the binding root (`/index.html`, `/assets/...`)
 * while the browser requests `/brainstorm/...`. Always strip the prefix
 * before ASSETS.fetch. Vite-dev module URLs keep the original request so HMR
 * still works.
 */
import { api } from "./api";
import { handleMcp } from "./mcp";
import {
  APP_PREFIX,
  isMcpPath,
  isViteDevPath,
  isRootAssetRedirect,
  stripPrefix,
  toAssetPath,
} from "./paths";
import { ensureSchema } from "./schema";
import { SessionRoom } from "./session-room";

export { SessionRoom };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // workers.dev `/` and the bare `/brainstorm` prefix need a trailing slash
    // so Vite `base: /brainstorm/` asset URLs resolve.
    if (url.pathname === "/" || url.pathname === APP_PREFIX) {
      url.pathname = `${APP_PREFIX}/`;
      return Response.redirect(url.toString(), 308);
    }

    if (url.pathname.startsWith(`${APP_PREFIX}/api/`)) {
      return api.fetch(request, env, ctx);
    }

    if (isMcpPath(url.pathname)) {
      return handleMcp(request, env, ctx);
    }

    const inner = stripPrefix(url.pathname);

    if (inner.startsWith("/ws/")) {
      await ensureSchema(env.DB);
      const sessionId = inner.slice("/ws/".length).split("/")[0];
      if (!sessionId) return new Response("Missing session", { status: 400 });
      return env.SESSION.getByName(sessionId).fetch(request);
    }

    if (!env.ASSETS) return new Response("Not found", { status: 404 });

    if (isViteDevPath(inner) || isViteDevPath(url.pathname)) {
      return env.ASSETS.fetch(request);
    }

    const assetPath = toAssetPath(url.pathname);
    let assetResponse = await env.ASSETS.fetch(
      new Request(new URL(assetPath + url.search, url.origin), request),
    );
    const location = assetResponse.headers.get("Location");
    // html_handling may 307 /index.html → /. Follow that inside ASSETS so the
    // browser never leaves /brainstorm/ for the apex site.
    if (location && assetResponse.status >= 300 && assetResponse.status < 400) {
      if (isRootAssetRedirect(location, url.origin)) {
        assetResponse = await env.ASSETS.fetch(
          new Request(new URL("/" + url.search, url.origin), request),
        );
      }
    }
    return assetResponse;
  },
};
