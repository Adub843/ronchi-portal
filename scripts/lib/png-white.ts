// Putting Fusion's renders on a plain white background. Fusion saves catalog renders with a
// see-through background; the catalog shows parts on white, so every pixel is blended onto white
// and the alpha channel dropped. Plain Node (zlib only), so the Fusion PC needs nothing installed.
// Handles the 8-bit RGB and RGBA PNGs Fusion writes; anything else is refused or left alone.
import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface Png {
  width: number;
  height: number;
  channels: 3 | 4;
  data: Uint8Array; // rows of pixels, no filter bytes
}

function chunks(buf: Uint8Array) {
  if (buf.length < 8 || SIGNATURE.some((b, i) => buf[i] !== b)) throw new Error("That file isn't a PNG.");
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: { type: string; data: Uint8Array }[] = [];
  for (let at = 8; at + 8 <= buf.length; ) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...buf.subarray(at + 4, at + 8));
    out.push({ type, data: buf.subarray(at + 8, at + 8 + len) });
    at += 12 + len;
    if (type === "IEND") break;
  }
  return out;
}

export function readPng(buf: Uint8Array): Png {
  const list = chunks(buf);
  const head = list.find((c) => c.type === "IHDR")?.data;
  if (!head) throw new Error("That PNG has no header.");
  const v = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const width = v.getUint32(0), height = v.getUint32(4), depth = head[8], type = head[9], interlace = head[12];
  if (depth !== 8 || (type !== 2 && type !== 6) || interlace !== 0) throw new Error("Only 8-bit RGB or RGBA PNGs without interlacing are handled.");
  const channels = type === 6 ? 4 : 3;
  const packed = Buffer.concat(list.filter((c) => c.type === "IDAT").map((c) => c.data));
  const raw = inflateSync(packed);
  const stride = width * channels;
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? data[row + x - channels]! : 0;
      const b = y ? data[row - stride + x]! : 0;
      const c = x >= channels && y ? data[row - stride + x - channels]! : 0;
      let p = raw[src + x]!;
      if (filter === 1) p += a;
      else if (filter === 2) p += b;
      else if (filter === 3) p += (a + b) >> 1;
      else if (filter === 4) {
        const e = a + b - c, pa = Math.abs(e - a), pb = Math.abs(e - b), pc = Math.abs(e - c);
        p += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error("That PNG uses an unknown filter.");
      data[row + x] = p & 0xff;
    }
  }
  return { width, height, channels, data };
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Write 8-bit RGB (3) or RGBA (4) pixels as a PNG. `filter` is for tests; 0 (None) is used otherwise. */
export function writePng(width: number, height: number, channels: 3 | 4, data: Uint8Array, filter = 0): Uint8Array {
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? data[y * stride + x - channels]! : 0;
      const b = y ? data[(y - 1) * stride + x]! : 0;
      const c = x >= channels && y ? data[(y - 1) * stride + x - channels]! : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const e = a + b - c, pa = Math.abs(e - a), pb = Math.abs(e - b), pc = Math.abs(e - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      raw[y * (stride + 1) + 1 + x] = (data[y * stride + x]! - pred) & 0xff;
    }
  }
  const head = new Uint8Array(13);
  const v = new DataView(head.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  head[8] = 8;
  head[9] = channels === 4 ? 6 : 2;
  const parts = [SIGNATURE, chunk("IHDR", head), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array(0))];
  return Buffer.concat(parts);
}

/** The same picture on white, without alpha. A PNG that has no alpha comes back unchanged. */
export function whitenPng(buf: Uint8Array): Uint8Array {
  const png = readPng(buf);
  if (png.channels === 3) return buf;
  const out = new Uint8Array(png.width * png.height * 3);
  for (let i = 0, j = 0; i < png.data.length; i += 4, j += 3) {
    const a = png.data[i + 3]!;
    for (let k = 0; k < 3; k++) out[j + k] = Math.round((png.data[i + k]! * a + 255 * (255 - a)) / 255);
  }
  return writePng(png.width, png.height, 3, out);
}
