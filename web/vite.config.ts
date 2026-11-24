import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The staff app is a plain single-page app. `npm run build:web` writes it to
// web/dist, and the portal Worker serves those files (see wrangler.portal.jsonc).
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
  server: {
    // During `npm run dev:web` the API calls go to the Worker running on 8787.
    proxy: { "/api": "http://localhost:8787" },
  },
});
