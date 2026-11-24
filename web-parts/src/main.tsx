import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/work-sans/400.css";
import "@fontsource/work-sans/500.css";
import "@fontsource/work-sans/600.css";
import "@fontsource/work-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "../../web/src/styles/base.css";
import "../../web/catalog/catalog.css";
import "./parts.css";
import { getLang } from "./i18n";
import { App } from "./App";

document.documentElement.lang = getLang();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
