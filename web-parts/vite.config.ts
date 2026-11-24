import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The customer parts app. `npm run build:parts` writes it to web-parts/dist, and the parts
// Worker serves those files (see wrangler.parts.jsonc). Ronchi theme only.
export default defineConfig({
  root: "web-parts",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 1000 },
  server: { port: 5174, proxy: { "/api": "http://localhost:8789" } },
});
