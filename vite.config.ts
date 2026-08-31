import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const appBase = process.env.BRAINSTORM_BASE_PATH
  ? `${process.env.BRAINSTORM_BASE_PATH.replace(/\/+$/, "")}/`
  : "/brainstorm/";

const baseNoSlash = appBase.replace(/\/+$/, "") || "/brainstorm";

function redirectBareBase(): Plugin {
  return {
    name: "redirect-bare-base",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathOnly = req.url?.split("?")[0] ?? "";
        if (pathOnly === baseNoSlash) {
          const query = req.url?.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
          res.statusCode = 308;
          res.setHeader("Location", `${baseNoSlash}/${query}`);
          res.end();
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: appBase,
  plugins: [redirectBareBase(), tailwindcss(), react(), cloudflare()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
  preview: {
    host: "0.0.0.0",
    port: 5173,
  },
});
