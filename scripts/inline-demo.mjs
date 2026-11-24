// Turns web/dist-demo into one HTML body (scripts and styles inlined) for the Claude preview.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = "web/dist-demo";
const html = readFileSync(join(dir, "index.html"), "utf8");
const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/g)].map((m) => readFileSync(join(dir, m[1]), "utf8")).join("\n");
const js = [...html.matchAll(/<script type="module"[^>]*src="\.\/([^"]+)"[^>]*><\/script>/g)].map((m) => readFileSync(join(dir, m[1]), "utf8")).join("\n");
const out = `<title>Ronchi Portal</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>${css}</style>
<div id="root"></div>
<script type="module">${js.replace(/<\/script/gi, "<\\/script")}</script>
`;
writeFileSync(join(dir, "ronchi-portal-preview.html"), out);
console.log(`wrote ${join(dir, "ronchi-portal-preview.html")} (${Math.round(out.length / 1024)} KB)`);
