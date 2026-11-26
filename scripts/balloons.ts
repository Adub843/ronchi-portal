// Find the balloons on a drawing whose numbers are drawn as lines, not typed (older manuals).
// The manual reader can't see those numbers, so the PC loader reads them off the picture:
//   1. find every circle of balloon size on the page,
//   2. read the number inside each one (Tesseract, digits only, three slightly different pictures),
//   3. keep a balloon only when at least two readings agree and the number is a position in the
//      parts list. A balloon that can't be read is left out: no spot beats a spot on the wrong part.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { createWorker, PSM, type Worker } from "tesseract.js";

export interface Balloon { pos: string; x: number; y: number; w: number; h: number }
interface Circle { x: number; y: number; r: number; score: number }

const lum = (d: Uint8ClampedArray, i: number) => (d[i * 4]! * 3 + d[i * 4 + 1]! * 6 + d[i * 4 + 2]!) / 10;

/** Circles with a clear rim and a little ink inside. `ink` is 1 where the picture is dark. Radii in pixels. */
export function findCircles(ink: Uint8Array, W: number, H: number, rMin: number, rMax: number): Circle[] {
  const ANG = 40, cos: number[] = [], sin: number[] = [];
  for (let a = 0; a < ANG; a++) { cos.push(Math.cos((a / ANG) * 2 * Math.PI)); sin.push(Math.sin((a / ANG) * 2 * Math.PI)); }
  const RING = 72, rc: number[] = [], rs: number[] = [];
  for (let a = 0; a < RING; a++) { rc.push(Math.cos((a / RING) * 2 * Math.PI)); rs.push(Math.sin((a / RING) * 2 * Math.PI)); }
  const out: Circle[] = [];
  const acc = new Uint16Array(W * H);
  for (let r = rMin; r <= rMax; r++) {
    acc.fill(0);
    // Every ink pixel votes for the centres it could be on the rim of.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!ink[y * W + x]) continue;
      for (let a = 0; a < ANG; a++) {
        const cx = Math.round(x + r * cos[a]!), cy = Math.round(y + r * sin[a]!);
        if (cx >= 0 && cy >= 0 && cx < W && cy < H) acc[cy * W + cx]!++;
      }
    }
    for (let y = r + 1; y < H - r - 1; y++) for (let x = r + 1; x < W - r - 1; x++) {
      const v = acc[y * W + x]!;
      if (v < ANG * 0.45) continue;
      // How much of the rim is really there (a leader line may break it).
      let on = 0;
      for (let a = 0; a < RING; a++) {
        const px = Math.round(x + r * rc[a]!), py = Math.round(y + r * rs[a]!);
        let hit = 0;
        for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1 && !hit; dx++) if (ink[(py + dy) * W + px + dx]) hit = 1;
        on += hit;
      }
      if (on / RING < 0.82) continue;
      // Inside: some ink (the number), not a filled shape, and a clear band just inside the rim.
      let inside = 0, area = 0, band = 0, bandN = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const d = Math.hypot(dx, dy);
        if (d < r * 0.62) { area++; inside += ink[(y + dy) * W + x + dx]!; }
        else if (d > r * 0.72 && d < r * 0.86) { bandN++; band += ink[(y + dy) * W + x + dx]!; }
      }
      if (inside / area < 0.012 || inside / area > 0.5 || band / bandN > 0.1) continue;
      // A balloon stands clear of the drawing: around it there is only its leader line.
      let around = 0, aroundN = 0;
      const R2 = Math.ceil(r * 1.45);
      for (let dy = -R2; dy <= R2; dy++) for (let dx = -R2; dx <= R2; dx++) {
        const d = Math.hypot(dx, dy), yy = y + dy, xx = x + dx;
        if (d < r * 1.15 || d > r * 1.45 || yy < 0 || xx < 0 || yy >= H || xx >= W) continue;
        aroundN++; around += ink[yy * W + xx]!;
      }
      if (around / aroundN > +(process.env.AROUND ?? 0.08)) continue;
      out.push({ x, y, r, score: on / RING + v / 1000 });
    }
  }
  out.sort((a, b) => b.score - a.score);
  const keep: Circle[] = [];
  for (const c of out) if (!keep.some((k) => Math.hypot(k.x - c.x, k.y - c.y) < Math.max(k.r, c.r))) keep.push(c);
  return keep;
}

let worker: Promise<Worker> | null = null;
function reader(): Promise<Worker> {
  worker ??= (async () => {
    // The language file ships in an npm package, so nothing is downloaded while loading manuals.
    const data = join(dirname(createRequire(import.meta.url).resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int");
    const w = await createWorker("eng", 1, { langPath: data, cacheMethod: "none" });
    await w.setParameters({ tessedit_char_whitelist: "0123456789", tessedit_pageseg_mode: PSM.SINGLE_WORD });
    return w;
  })();
  return worker;
}
export async function closeReader() { if (worker) await (await worker).terminate(); worker = null; }

/** One balloon's inside, cut round, blown up to `size` pixels and its lines thickened by `thick`. */
function crop(page: Canvas, cx: number, cy: number, R: number, size: number, thick: number, turn: number): Buffer {
  const s = R * 0.8, P = 40;
  const c = createCanvas(size + P * 2, size + P * 2);
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  g.save(); g.beginPath(); g.arc(c.width / 2, c.height / 2, size / 2, 0, Math.PI * 2); g.clip();
  // Drawings printed sideways have their numbers on their side: turn the cut so they stand up.
  g.translate(c.width / 2, c.height / 2); g.rotate((turn * Math.PI) / 180); g.translate(-c.width / 2, -c.height / 2);
  g.drawImage(page, cx - s, cy - s, s * 2, s * 2, P, P, size, size); g.restore();
  const im = g.getImageData(0, 0, c.width, c.height), w = c.width, h = c.height;
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) dark[i] = lum(im.data, i) < 225 ? 1 : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let on = 0;
    for (let dy = -thick; dy <= thick && !on; dy++) for (let dx = -thick; dx <= thick && !on; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && xx >= 0 && yy < h && xx < w && dark[yy * w + xx]) on = 1;
    }
    const i = (y * w + x) * 4;
    im.data[i] = im.data[i + 1] = im.data[i + 2] = on ? 0 : 255; im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  return c.toBuffer("image/png");
}

const LOOKS: [size: number, thick: number][] = [[420, 4], [420, 2], [300, 1]];

/**
 * The balloons on a drawn page. `page` is the page picture, `pointsWide` the page's width in PDF
 * points, `positions` the position numbers in its parts list. Balloons differ a lot from drawing
 * to drawing (5 to 45 points in radius), and some drawings are printed sideways, so every size
 * and three ways up are tried. Answers spots as fractions of the picture, like the typed-balloon reader.
 */
export async function findBalloons(page: Canvas, pointsWide: number, positions: Set<string>): Promise<{ balloons: Balloon[]; circles: number; unread: number; turn: number }> {
  const PW = page.width, PH = page.height;
  const d = page.getContext("2d").getImageData(0, 0, PW, PH).data;
  // A smaller copy where a pixel is ink if anything under it is: thin grey lines survive the shrink.
  const shrink = (pxPerPoint: number) => {
    const f = (pointsWide * pxPerPoint) / PW, W = Math.ceil(PW * f), H = Math.ceil(PH * f);
    const ink = new Uint8Array(W * H);
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) if (lum(d, y * PW + x) < 200) ink[Math.floor(y * f) * W + Math.floor(x * f)] = 1;
    return { ink, W, H, f };
  };
  // Small balloons on a 2 pixels per point copy, big ones on a coarser one: both stay quick.
  const circles: Circle[] = [];
  for (const [ppp, rMin, rMax] of [[2, 10, 27], [0.7, 9, 32]] as const) {
    const { ink, W, H, f } = shrink(ppp);
    for (const c of findCircles(ink, W, H, rMin, rMax)) {
      const full = { x: c.x / f, y: c.y / f, r: c.r / f, score: c.score };
      if (!circles.some((k) => Math.hypot(k.x - full.x, k.y - full.y) < Math.max(k.r, full.r))) circles.push(full);
    }
  }
  const w = await reader();
  const readAll = async (turn: number) => {
    const read: { c: Circle; pos: string; votes: number }[] = [];
    for (const c of circles) {
      const votes = new Map<string, number>();
      for (const [size, thick] of LOOKS) {
        const t = (await w.recognize(crop(page, c.x, c.y, c.r, size, thick, turn))).data.text.trim().replace(/^0+(?=\d)/, "");
        if (t) votes.set(t, (votes.get(t) ?? 0) + 1);
        // Two the same settle it; no need for the third look.
        if ((votes.get(t) ?? 0) >= 2) break;
      }
      const best = [...votes].sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] >= 2 && positions.has(best[0])) read.push({ c, pos: best[0], votes: best[1] });
    }
    return read;
  };
  // Upright first; when that reads under half the circles, the drawing is probably on its side.
  let turn = 0;
  let read = await readAll(0);
  if (circles.length >= 2 && read.length < circles.length * 0.5) {
    for (const t of [90, -90]) {
      const r = await readAll(t);
      if (r.length > read.length) { read = r; turn = t; }
    }
  }
  // Every balloon on a page is drawn the same size; a "balloon" of another size is a round part of
  // the drawing that happened to read as a number.
  const usual = read.map((r) => r.c.r).sort((a, b) => a - b)[Math.floor(read.length / 2)] ?? 0;
  read = read.filter((r) => Math.abs(r.c.r - usual) <= Math.max(usual * 0.08, PW / (pointsWide * 2)));
  // The same number on two balloons while another position has none usually means a digit was
  // missed (71 read as 7). Keep the surest one and leave the others out.
  const missing = [...positions].some((p) => !read.some((r) => r.pos === p));
  const balloons: Balloon[] = [];
  for (const r of read.sort((a, b) => b.votes - a.votes || b.c.score - a.c.score)) {
    if (missing && balloons.some((b) => b.pos === r.pos)) continue;
    const size = r.c.r * 2.1;
    balloons.push({ pos: r.pos, x: Math.max(0, (r.c.x - size / 2) / PW), y: Math.max(0, (r.c.y - size / 2) / PH), w: size / PW, h: size / PH });
  }
  return { balloons, circles: circles.length, unread: circles.length - balloons.length, turn };
}
