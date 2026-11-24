// THE WALL, enforced by the build. These checks fail if anyone ever connects the
// customer help center to the business data, by config or by code.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("customer / business wall", () => {
  const helpConfig = JSON.parse(stripComments(readFileSync("wrangler.help.jsonc", "utf8")));
  const portalConfig = JSON.parse(stripComments(readFileSync("wrangler.portal.jsonc", "utf8")));

  it("the help center's only database is help-db, in every environment", () => {
    const envs = [helpConfig, ...Object.values(helpConfig.env ?? {})] as any[];
    for (const e of envs) {
      expect((e.d1_databases ?? []).map((d: any) => d.database_name)).toEqual(["help-db"]);
      for (const key of ["kv_namespaces", "r2_buckets", "services", "durable_objects", "hyperdrive", "queues", "vars"]) {
        expect(e[key], `help center must not have ${key}`).toBeUndefined();
      }
    }
  });

  it("the two sides never share a database", () => {
    const portalDbs = [portalConfig, ...Object.values(portalConfig.env ?? {})].flatMap((e: any) => (e.d1_databases ?? []).map((d: any) => d.database_name));
    expect(portalDbs).not.toContain("help-db-readonly");
    expect(portalDbs).not.toContain(undefined);
    expect(new Set(portalDbs)).toEqual(new Set(["portal-db"]));
  });

  it("help center code imports only from src/help and src/shared", () => {
    for (const f of files("src/help")) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) {
        const spec = m[1]!;
        if (!spec.startsWith(".")) continue;
        const resolved = join(f, "..", spec);
        expect(resolved.startsWith("src/help") || resolved.startsWith("src/shared"), `${f} imports ${spec}`).toBe(true);
      }
      expect(src).not.toMatch(/portal-db|\bDB\b\s*:/);
    }
  });

  it("customers only ever see the Ronchi workbook theme", () => {
    // The help center has its own fixed Ronchi stylesheet and never loads the staff theme list.
    for (const f of files("src/help")) expect(readFileSync(f, "utf8"), f).not.toMatch(/themes|data-theme|user_prefs/);
    expect(readFileSync("src/help/html.ts", "utf8")).toContain("--accent:#e30613");
  });

  it("shared code never reaches into either side", () => {
    for (const f of files("src/shared")) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/from\s+["']\.\.\/(portal|help)/);
    }
  });

  it("help-db's schema has no customer, site, machine-number or staff columns", () => {
    const sql = files("migrations/help").map((f) => readFileSync(f, "utf8")).join("\n").replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/\b(customer|site|serial|machine_id|user_id|email|price)\b/i);
  });
});
