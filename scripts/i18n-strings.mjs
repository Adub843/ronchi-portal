// Lists every t("...") text in the staff app, for i18n-dict.ts and its test.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export function texts(dir = "web/src") {
  const out = new Set();
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f) && !/i18n(-dict)?\.ts$/.test(f) && !p.includes("/demo/")) {
        for (const m of readFileSync(p, "utf8").matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) out.add(JSON.parse(`"${m[1]}"`));
      }
    }
  };
  walk(dir);
  return [...out].sort();
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(texts(), null, 1));
