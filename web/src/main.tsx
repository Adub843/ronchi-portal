import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/work-sans/400.css";
import "@fontsource/work-sans/500.css";
import "@fontsource/work-sans/600.css";
import "@fontsource/work-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles/base.css";
import "./styles/app.css";
import { App } from "./App";

// The preview shown inside Claude answers API calls from example data (see demo/mock.ts).
// In the real portal this block is removed at build time.
if (import.meta.env.MODE === "demo") {
  document.documentElement.classList.add("demo");
  const demo = await import("./demo/mock");
  demo.installDemo();
}

// After a new version goes live, a tab left open still asks for the old version's page pieces, which
// are gone. Reload once to pick up the new version instead of showing a blank page.
window.addEventListener("vite:preloadError", (e) => {
  const key = "portal:reloaded-for-update";
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch {
    return;
  }
  e.preventDefault();
  location.reload();
});
window.setTimeout(() => {
  try { sessionStorage.removeItem("portal:reloaded-for-update"); } catch { /* private mode */ }
}, 30_000);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
