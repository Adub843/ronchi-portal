// Catalog renders from Fusion, run on the PC where Fusion and its LabBridge add-in run.
//
//   node scripts/fusion-renders.mjs <assembly.step> [--out <folder>] [--size 1024] [--max-parts 3000] [--wait 7200] [--keep]
//   node scripts/fusion-renders.mjs --demo [--out <folder>]
//
// Hands the STEP file to LabBridge (a job folder in %LOCALAPPDATA%\CreativeLab\fusion-jobs\inbox)
// with the recipe scripts/fusion/catalog-renders.py, waits for Fusion to finish, puts every picture
// on a white background and copies the result to the output folder (default: "<file name> renders"
// next to the STEP file):
//   view-iso.png, view-front.png, view-top.png, view-right.png, part-<name>.png ..., manifest.json
// Staff then open a parts list in the portal catalog, press "Add Fusion pictures" and pick all of
// these files: each part picture lands on the rows with the same part number, and the views become
// that parts list's 3D pictures.
//
// --demo first builds a small test assembly in Fusion (plate, shaft group, bush, four screws),
// exports it as STEP and then renders that, to check the whole chain without real CAD.
// The job folders this script makes are deleted when it ends (--keep leaves them for a look).
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { whitenPng } from "./lib/png-white.ts";

const here = dirname(fileURLToPath(import.meta.url));
const JOBS = process.env.LAB_FUSION_JOBS || join(process.env.LOCALAPPDATA || join(process.env.HOME || ".", "AppData", "Local"), "CreativeLab", "fusion-jobs");
const INBOX = join(JOBS, "inbox");
const RECIPE = readFileSync(join(here, "fusion", "catalog-renders.py"), "utf8");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const demo = flag("--demo");
const keep = flag("--keep");
const WITH_VALUE = ["--out", "--size", "--max-parts", "--wait"];
const input = args.find((a, i) => !a.startsWith("--") && !WITH_VALUE.includes(args[i - 1] ?? ""));
const size = Math.min(4096, Math.max(128, Number(opt("--size", "1024")) || 1024));
const maxParts = Math.max(1, Number(opt("--max-parts", "3000")) || 3000);
const waitSeconds = Math.max(30, Number(opt("--wait", "7200")) || 7200);

if (!demo && !input) {
  console.error("Usage: node scripts/fusion-renders.mjs <assembly.step> [--out <folder>] [--size 1024] [--max-parts 3000] [--wait 7200] [--keep]\n       node scripts/fusion-renders.mjs --demo [--out <folder>]");
  process.exit(2);
}
if (input && !/\.(step|stp)$/i.test(input)) {
  console.error("Give a STEP file (.step or .stp). For SolidWorks files, make the STEP first (Fusion add-in RonchiPortalExport).");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const made = [];

function fusionStatus() {
  try {
    const hb = JSON.parse(readFileSync(join(JOBS, "heartbeat.json"), "utf8"));
    return { age: Date.now() / 1000 - hb.at, fusion: hb.fusion };
  } catch {
    return null;
  }
}

function waitingAhead(mine) {
  if (!existsSync(INBOX)) return 0;
  return readdirSync(INBOX).filter((d) => d !== mine && existsSync(join(INBOX, d, "job.json")) && !existsSync(join(INBOX, d, "result.json"))).length;
}

/** Put one job in LabBridge's inbox and wait for its result.json. */
async function runJob(id, name, code, params, formats, file) {
  const folder = join(INBOX, id);
  mkdirSync(folder, { recursive: true });
  made.push(folder);
  if (file) copyFileSync(file, join(folder, "input.step"));
  // job.json last, and in one step, so LabBridge never sees half a job.
  writeFileSync(join(folder, "job.json.tmp"), JSON.stringify({ id, name, code, params, formats }));
  renameSync(join(folder, "job.json.tmp"), join(folder, "job.json"));
  const ahead = waitingAhead(id);
  console.log(`${name}: queued as ${id}${ahead ? ` (${ahead} other Fusion job${ahead > 1 ? "s" : ""} ahead)` : ""}`);
  const until = Date.now() + waitSeconds * 1000;
  let told = 0;
  while (Date.now() < until) {
    const res = join(folder, "result.json");
    if (existsSync(res)) {
      await sleep(300);
      return { folder, result: JSON.parse(readFileSync(res, "utf8")) };
    }
    if (Date.now() - told > 60_000) {
      const s = fusionStatus();
      if (told) console.log(`  still waiting… ${s && s.age < 60 ? "Fusion is idle" : "Fusion is busy or closed"}`);
      told = Date.now();
    }
    await sleep(2000);
  }
  throw new Error(`Fusion didn't finish within ${waitSeconds} s. Is Fusion open with LabBridge running?`);
}

function cleanUp() {
  if (keep) {
    for (const f of made) console.log(`kept job folder ${f}`);
    return;
  }
  for (const f of made) {
    try {
      rmSync(f, { recursive: true, force: true });
    } catch (e) {
      console.warn(`couldn't remove ${f}: ${e.message}`);
    }
  }
}

async function main() {
  const s = fusionStatus();
  if (!s) console.warn("No LabBridge heartbeat yet: open Fusion (LabBridge starts with it). The job waits in the inbox.");
  else if (s.age > 120 && !waitingAhead("")) console.warn(`LabBridge last answered ${Math.round(s.age)} s ago: is Fusion open?`);

  let step = input ? resolve(input) : null;
  let source = step ? basename(step) : "demo-assembly.step";
  const t = stamp();
  if (demo) {
    const { folder, result } = await runJob(`catalog-demo-${t}`, "Catalog renders: test assembly", RECIPE + "\nmake = make_demo\n", {}, ["step"], null);
    if (!result.ok) throw new Error(`Fusion couldn't build the test assembly:\n${result.error}`);
    step = join(folder, "model.step");
  }
  const { folder, result } = await runJob(`catalog-renders-${t}`, `Catalog renders: ${source}`, RECIPE, { size, max_parts: maxParts, source }, ["none"], step);
  if (!result.ok) throw new Error(`Fusion couldn't render ${source}:\n${result.error}`);

  const from = join(folder, "renders");
  const manifest = JSON.parse(readFileSync(join(from, "manifest.json"), "utf8"));
  const out = resolve(opt("--out", demo ? "fusion-renders-demo" : join(dirname(step), `${basename(step).replace(/\.(step|stp)$/i, "")} renders`)));
  mkdirSync(out, { recursive: true });
  let pictures = 0;
  for (const f of readdirSync(from)) {
    if (!f.toLowerCase().endsWith(".png")) continue;
    writeFileSync(join(out, f), whitenPng(readFileSync(join(from, f))));
    pictures++;
  }
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 1));
  if (demo) copyFileSync(step, join(out, source));

  const coded = manifest.parts.filter((p) => p.code).length;
  console.log(`Done in ${result.seconds} s: ${Object.keys(manifest.views).length} views and ${manifest.parts.filter((p) => p.file).length} part pictures (${coded} with a part number) in\n  ${out}`);
  for (const n of manifest.notes ?? []) console.log(`  note: ${n}`);
  const missing = manifest.parts.filter((p) => !p.code).slice(0, 10).map((p) => p.name);
  if (missing.length) console.log(`  names without a part number (they won't match a parts list): ${missing.join(", ")}${manifest.parts.length - coded > 10 ? " …" : ""}`);
  return pictures;
}

main()
  .then(() => cleanUp())
  .catch((e) => {
    console.error(e.message);
    cleanUp();
    process.exit(1);
  });
