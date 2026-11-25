import { describe, expect, it } from "vitest";
import { readPng, whitenPng, writePng } from "../../scripts/lib/png-white";

describe("putting Fusion renders on white", () => {
  // 3 x 1 pixels: clear, half-see-through red, solid blue.
  const rgba = Uint8Array.from([0, 0, 0, 0, 255, 0, 0, 128, 0, 0, 255, 255]);

  it("blends see-through pixels onto white and drops the alpha channel", () => {
    const out = readPng(whitenPng(writePng(3, 1, 4, rgba)));
    expect(out.channels).toBe(3);
    expect([...out.data]).toEqual([255, 255, 255, 255, 127, 127, 0, 0, 255]);
  });

  it("reads back every PNG filter type", () => {
    // Rows filtered with Sub, Up, Average and Paeth must decode to the same pixels.
    const w = 2, h = 5;
    const px = Uint8Array.from({ length: w * h * 4 }, (_, i) => (i * 37) % 256);
    for (const filter of [0, 1, 2, 3, 4]) expect([...readPng(writePng(w, h, 4, px, filter)).data]).toEqual([...px]);
  });

  it("leaves a picture with no alpha as it is", () => {
    const rgb = writePng(1, 1, 3, Uint8Array.from([10, 20, 30]));
    expect(whitenPng(rgb)).toBe(rgb);
  });

  it("refuses a file that isn't a PNG", () => {
    expect(() => readPng(new TextEncoder().encode("not a png at all"))).toThrow(/PNG/);
  });
});
