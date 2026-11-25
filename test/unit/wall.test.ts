// THE WALL, enforced by the build. These checks fail if anyone ever connects the
// customer help center to the business data, by config or by code.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { posix } from "node:path";
const { join } = posix;
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

  it("shared code never reaches into any side", () => {
    for (const f of files("src/shared")) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/from\s+["']\.\.\/(\.\.\/)?(portal|help|parts)/);
    }
  });

  it("help-db's schema has no customer, site, machine-number or staff columns", () => {
    const sql = files("migrations/help").map((f) => readFileSync(f, "utf8")).join("\n").replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/\b(customer|site|serial|machine_id|user_id|email|price)\b/i);
  });
});

describe("customer parts site wall", () => {
  const partsConfig = JSON.parse(stripComments(readFileSync("wrangler.parts.jsonc", "utf8")));
  const portalConfig = JSON.parse(stripComments(readFileSync("wrangler.portal.jsonc", "utf8")));
  const helpConfig = JSON.parse(stripComments(readFileSync("wrangler.help.jsonc", "utf8")));
  const envsOf = (cfg: any) => [cfg, ...Object.values(cfg.env ?? {})] as any[];

  it("the parts site's only database is parts-db and its only bucket is its own, in every environment", () => {
    for (const e of envsOf(partsConfig)) {
      expect((e.d1_databases ?? []).map((d: any) => d.database_name)).toEqual(["parts-db"]);
      expect((e.r2_buckets ?? []).map((b: any) => b.bucket_name)).toEqual(["ronchi-parts-files"]);
      for (const key of ["kv_namespaces", "services", "durable_objects", "hyperdrive", "queues", "workflows", "analytics_engine_datasets"]) {
        expect(e[key], `parts site must not have ${key}`).toBeUndefined();
      }
      for (const v of Object.keys(e.vars ?? {})) expect(["ORIGIN", "RP_ID", "RP_NAME"]).toContain(v);
    }
  });

  it("no other Worker binds parts-db or the parts bucket", () => {
    for (const cfg of [portalConfig, helpConfig]) {
      for (const e of envsOf(cfg)) {
        expect((e.d1_databases ?? []).map((d: any) => d.database_name)).not.toContain("parts-db");
        expect((e.r2_buckets ?? []).map((b: any) => b.bucket_name)).not.toContain("ronchi-parts-files");
      }
    }
  });

  it("parts-db never shares a database id with the staff or help databases, so a mix-up can't point it at their data", () => {
    const idsOf = (cfg: any) => envsOf(cfg).flatMap((e) => (e.d1_databases ?? []).map((d: any) => d.database_id));
    const others = new Set([...idsOf(portalConfig), ...idsOf(helpConfig)]);
    for (const id of idsOf(partsConfig)) expect(others.has(id), `parts-db id ${id} is also used by another Worker`).toBe(false);
  });

  it("the portal reaches the two customer sites only through their service bindings, never the other way", () => {
    for (const e of envsOf(portalConfig)) {
      expect((e.services ?? []).map((s: any) => `${s.binding}=${s.service}`).sort()).toEqual(["HELP=ronchi-help", "PARTS=ronchi-parts"]);
    }
    for (const e of envsOf(helpConfig)) expect(e.services).toBeUndefined();
  });

  it("parts site code imports only from src/parts and src/shared, and never names the business store", () => {
    for (const f of files("src/parts")) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
        const spec = m[1]!;
        if (!spec.startsWith(".")) continue;
        const resolved = join(f, "..", spec);
        expect(resolved.startsWith("src/parts") || resolved.startsWith("src/shared"), `${f} imports ${spec}`).toBe(true);
      }
      expect(stripComments(src), f).not.toMatch(/portal-db|ronchi-portal-files|env\.DB\b|env\.FILES\b|HELP_DB/);
    }
  });

  it("staff code never imports the parts site's code or binds its database", () => {
    for (const f of [...files("src/portal"), ...files("src/help")]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/from\s+["'][./]*parts\//);
      expect(src, f).not.toMatch(/PARTS_DB|PARTS_FILES/);
    }
  });

  it("parts-db's schema has no prices, costs or staff-only fields", () => {
    const sql = files("migrations/parts").map((f) => readFileSync(f, "utf8")).join("\n").replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/\b(price|cost|margin|supplier|staff|internal|catalog_notes)\b/i);
  });

  it("customers only ever see the Ronchi theme", () => {
    for (const f of files("src/parts")) expect(readFileSync(f, "utf8"), f).not.toMatch(/user_prefs|data-theme/);
  });
});
