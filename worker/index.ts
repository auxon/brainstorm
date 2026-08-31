/**
 * Brainstorm Worker — mounted at /brainstorm on entangleit.com.
 *
 * Vite dev serves the SPA at the configured `base` (`/brainstorm/`), so we
 * forward the original URL to ASSETS first. Production assets live at the
 * binding root (`/index.html`, `/assets/...`), so on miss we strip the prefix
 * and try again.
 */
import { api } from "./api";
import { APP_PREFIX, stripPrefix } from "./paths";
import { ensureSchema } from "./schema";
import { SessionRoom } from "./session-room";

export { SessionRoom };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      url.pathname = `${APP_PREFIX}/`;
      return Response.redirect(url.toString(), 308);
    }

    if (url.pathname.startsWith(`${APP_PREFIX}/api/`)) {
      return api.fetch(request, env, ctx);
    }

    const inner = stripPrefix(url.pathname);

    if (inner.startsWith("/ws/")) {
      await ensureSchema(env.DB);
      const sessionId = inner.slice("/ws/".length).split("/")[0];
      if (!sessionId) return new Response("Missing session", { status: 400 });
      return env.SESSION.getByName(sessionId).fetch(request);
    }

    if (!env.ASSETS) return new Response("Not found", { status: 404 });

    const direct = await env.ASSETS.fetch(request);
    if (direct.status !== 404) return direct;

    return env.ASSETS.fetch(new Request(new URL(inner + url.search, url.origin), request));
  },
};
