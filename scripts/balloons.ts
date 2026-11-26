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

/** Circles with a clear rim and a little ink inside, on a grey picture. Radii in pixels. */
export function findCircles(gray: Uint8Array, W: number, H: number, rMin: number, rMax: number): Circle[] {
  const ink = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (gray[i]! < 200) ink[i] = 1;
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
      if (inside / area < 0.03 || inside / area > 0.5 || band / bandN > 0.1) continue;
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
function crop(page: Canvas, cx: number, cy: number, R: number, size: number, thick: number): Buffer {
  const s = R * 0.8, P = 40;
  const c = createCanvas(size + P * 2, size + P * 2);
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  g.save(); g.beginPath(); g.arc(c.width / 2, c.height / 2, size / 2, 0, Math.PI * 2); g.clip();
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
 * points (balloons are 5 to 13 points in radius), `positions` the position numbers in its parts list,
 * `radius` the balloon size other pages of this manual settled on (in the 2 pixels per point copy), to look faster.
 * Answers spots as fractions of the picture, like the typed-balloon reader does.
 */
export async function findBalloons(page: Canvas, pointsWide: number, positions: Set<string>, radius?: number): Promise<{ balloons: Balloon[]; circles: number; unread: number; radius: number }> {
  // Look for circles on a copy at 2 pixels per point: fast, and the rim is still a clean line.
  const W = Math.round(pointsWide * 2), f = W / page.width, H = Math.round(page.height * f);
  const small = createCanvas(W, H);
  const g = small.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  g.drawImage(page, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data;
  const gray = new Uint8Array(W * H);
  for (let i = 0; i < gray.length; i++) gray[i] = lum(d, i);
  const circles = radius ? findCircles(gray, W, H, radius - 2, radius + 2) : findCircles(gray, W, H, 10, 26);
  const w = await reader();
  const read: { c: Circle; pos: string; votes: number }[] = [];
  let unread = 0;
  for (const c of circles) {
    const votes = new Map<string, number>();
    for (const [size, thick] of LOOKS) {
      const t = (await w.recognize(crop(page, c.x / f, c.y / f, c.r / f, size, thick))).data.text.trim().replace(/^0+(?=\d)/, "");
      if (t) votes.set(t, (votes.get(t) ?? 0) + 1);
      // Two the same settle it; no need for the third look.
      if ((votes.get(t) ?? 0) >= 2) break;
    }
    const best = [...votes].sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 2 && positions.has(best[0])) read.push({ c, pos: best[0], votes: best[1] });
    else unread++;
  }
  // The same number on two balloons while another position has none usually means a digit was
  // missed (71 read as 7). Keep the surest one and leave the others out.
  // Every balloon on a page is drawn the same size; a "balloon" of another size is a round part of
  // the drawing that happened to read as a number.
  const sizes = new Map<number, number>();
  for (const r of read) sizes.set(r.c.r, (sizes.get(r.c.r) ?? 0) + 1);
  const usual = [...sizes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  for (let i = read.length - 1; i >= 0; i--) if (Math.abs(read[i]!.c.r - usual) > 1) { read.splice(i, 1); unread++; }
  const missing = [...positions].some((p) => !read.some((r) => r.pos === p));
  const balloons: Balloon[] = [];
  for (const r of read.sort((a, b) => b.votes - a.votes || b.c.score - a.c.score)) {
    if (missing && balloons.some((b) => b.pos === r.pos)) { unread++; continue; }
    const size = (r.c.r * 2.1) / f;
    balloons.push({ pos: r.pos, x: Math.max(0, (r.c.x / f - size / 2) / page.width), y: Math.max(0, (r.c.y / f - size / 2) / page.height), w: size / page.width, h: size / page.height });
  }
  return { balloons, circles: circles.length, unread, radius: balloons.length >= 3 ? usual : 0 };
}
