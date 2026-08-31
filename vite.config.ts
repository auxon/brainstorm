import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const appBase = process.env.BRAINSTORM_BASE_PATH
  ? `${process.env.BRAINSTORM_BASE_PATH.replace(/\/+$/, "")}/`
  : "/brainstorm/";

export default defineConfig({
  base: appBase,
  plugins: [tailwindcss(), react(), cloudflare()],
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
