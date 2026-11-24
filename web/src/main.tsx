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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
