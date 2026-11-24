import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * pdf.js needs its font and image helpers next to the app when it reads a manual
 * (web/src/catalog/pdf.ts points at /pdfjs/...). This copies them from the installed package.
 */
function pdfjsFiles(): Plugin {
  const dirs = ["wasm", "standard_fonts", "cmaps"];
  const root = "node_modules/pdfjs-dist";
  return {
    name: "pdfjs-files",
    apply: "build",
    generateBundle() {
      for (const d of dirs) {
        for (const f of readdirSync(join(root, d))) {
          this.emitFile({ type: "asset", fileName: `pdfjs/${d}/${f}`, source: readFileSync(join(root, d, f)) });
        }
      }
    },
  };
}

// The staff app is a plain single-page app. `npm run build:web` writes it to
// web/dist, and the portal Worker serves those files (see wrangler.portal.jsonc).
export default defineConfig({
  root: "web",
  plugins: [react(), pdfjsFiles()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 1500 },
  server: {
    // During `npm run dev:web` the API calls go to the Worker running on 8787.
    proxy: { "/api": "http://localhost:8787" },
  },
});
