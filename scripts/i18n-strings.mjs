// Lists every t("...") text in the staff app, for i18n-dict.ts and its test.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function texts(dir = "web/src") {
  const out = new Set();
  const walk = (d) => {
    // withFileTypes gives each entry's type from the same directory read (no separate stat call).
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = e.name;
      const p = join(d, f);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && /\.tsx?$/.test(f) && !/i18n(-dict)?\.ts$/.test(f) && !p.includes("/demo/")) {
        for (const m of readFileSync(p, "utf8").matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) out.add(JSON.parse(`"${m[1]}"`));
      }
    }
  };
  walk(dir);
  return [...out].sort();
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(texts(), null, 1));
