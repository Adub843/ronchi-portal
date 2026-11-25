// The looks from "Ronchi Portal looks" (https://claude.ai/artifact/57Fs16BpjDhT3u32Nc5bWb), minus
// "Ronchi Red Steel" (T1), which Aaron removed on 2026-11-24. Ids are kept stable, so T2..T20 remain,
// plus the default Ronchi workbook theme. Each person picks one in Settings; it is saved to their login.
// The customer help center always uses the Ronchi theme.

export interface ThemeTokens {
  bg: string; solid: string; line: string; ink: string; muted: string;
  accent: string; accentInk: string; ok: string; okSoft: string; steel: string; steelInk: string;
  radius: string; dark: boolean;
}
export interface Theme { id: string; name: string; blurb: string; tokens: ThemeTokens | null }

export const DEFAULT_THEME = "ronchi";

export const THEMES: Theme[] = [
  { id: "ronchi", name: "Ronchi Workbook", blurb: "The Field Service Workbook look: light grey, white panels, Ronchi red. Follows light or dark mode.", tokens: null },
  { id: "T2", name: "Night Shift", blurb: "Dark control-room look that's easy on the eyes on site.", tokens: {bg: "#0f151b",solid: "#17202a",line: "#2a3642",ink: "#e6ebf0",muted: "#97a3b0",accent: "#ff4d64",accentInk: "#fff",ok: "#5fd39a",okSoft: "#14321f",steel: "#0a0f14",steelInk: "#dfe6ed",radius: "3px",dark: true} },
  { id: "T3", name: "Clean White Lab", blurb: "Bright white with one blue accent. Very calm and clinical.", tokens: {bg: "#ffffff",solid: "#fff",line: "#e2e7ec",ink: "#1b2530",muted: "#667381",accent: "#1d6fd1",accentInk: "#fff",ok: "#1a7f4b",okSoft: "#e4f4ea",steel: "#f6f8fa",steelInk: "#24303c",radius: "8px",dark: false} },
  { id: "T4", name: "Italian Heritage", blurb: "Deep green, cream and brass, a nod to Ronchi's Italian roots.", tokens: {bg: "#f6f3ec",solid: "#fffdf8",line: "#e1dacb",ink: "#1d2620",muted: "#5f665f",accent: "#a8792a",accentInk: "#fff",ok: "#2c6e49",okSoft: "#e2efe5",steel: "#1f3b2f",steelInk: "#efe9da",radius: "4px",dark: false} },
  { id: "T5", name: "Safety Yellow", blurb: "Charcoal with machine-guard yellow. Loud and very readable.", tokens: {bg: "#efefec",solid: "#fff",line: "#d9d9d3",ink: "#1e1f22",muted: "#5c5d60",accent: "#f2b705",accentInk: "#1e1f22",ok: "#2b7a3d",okSoft: "#e4f1e6",steel: "#1e1f22",steelInk: "#f2f2ee",radius: "2px",dark: false} },
  { id: "T6", name: "Stainless", blurb: "Brushed metal greys with a cool teal accent, like the machines.", tokens: {bg: "#e9ecee",solid: "#f7f8f9",line: "#cfd5da",ink: "#1f2a33",muted: "#58646e",accent: "#0f7c86",accentInk: "#fff",ok: "#2b7a55",okSoft: "#dfeee6",steel: "#c9cfd4",steelInk: "#1f2a33",radius: "4px",dark: false} },
  { id: "T7", name: "Blueprint", blurb: "Engineering blue with white lines, like a drawing sheet.", tokens: {bg: "#0f3a63",solid: "#134673",line: "#2b5e8e",ink: "#eef5fc",muted: "#a9c3dc",accent: "#ffd447",accentInk: "#0b2c4b",ok: "#7fe0a8",okSoft: "#1d5a48",steel: "#0b2c4b",steelInk: "#dbe9f7",radius: "2px",dark: true} },
  { id: "T8", name: "Executive Navy", blurb: "Navy and soft gold. Polished, good for showing customers.", tokens: {bg: "#f5f6f9",solid: "#fff",line: "#dfe3ec",ink: "#16213e",muted: "#5b6479",accent: "#b88a2a",accentInk: "#fff",ok: "#24785a",okSoft: "#e2f2ea",steel: "#16213e",steelInk: "#e9ecf4",radius: "6px",dark: false} },
  { id: "T9", name: "Signal Orange", blurb: "Graphite with a bright orange accent for alerts and actions.", tokens: {bg: "#f4f4f5",solid: "#fff",line: "#e0e0e3",ink: "#202226",muted: "#62656c",accent: "#ea5b0c",accentInk: "#fff",ok: "#23804d",okSoft: "#e2f2e8",steel: "#26282c",steelInk: "#eeeef0",radius: "4px",dark: false} },
  { id: "T10", name: "Soft Slate", blurb: "Muted blue-grey everywhere. Quiet and easy for long days.", tokens: {bg: "#eef1f4",solid: "#f9fafb",line: "#d6dde4",ink: "#2c3a48",muted: "#667585",accent: "#4f6d8f",accentInk: "#fff",ok: "#3a7d5c",okSoft: "#e2efe8",steel: "#e1e6ec",steelInk: "#2c3a48",radius: "10px",dark: false} },
  { id: "T11", name: "Plant Floor HMI", blurb: "Looks like a machine HMI: dark grey, status green and amber.", tokens: {bg: "#2a2e33",solid: "#353a40",line: "#4a5057",ink: "#eef1f4",muted: "#a7b0b9",accent: "#2fbf71",accentInk: "#0f1a13",ok: "#f0b54a",okSoft: "#4a3a18",steel: "#1d2024",steelInk: "#cfd5db",radius: "2px",dark: true} },
  { id: "T12", name: "Crisp Monochrome", blurb: "Black, white and grey only, with red used just for alerts.", tokens: {bg: "#fafafa",solid: "#fff",line: "#e5e5e5",ink: "#111",muted: "#666",accent: "#111",accentInk: "#fff",ok: "#111",okSoft: "#ececec",steel: "#111",steelInk: "#f5f5f5",radius: "0px",dark: false} },
  { id: "T13", name: "Ocean Teal", blurb: "Fresh teal and white. Friendly for customers and field service engineers.", tokens: {bg: "#f2f8f8",solid: "#fff",line: "#d6e7e8",ink: "#14313a",muted: "#55707a",accent: "#0d9488",accentInk: "#fff",ok: "#1f7a4d",okSoft: "#e0f2e8",steel: "#0d5c63",steelInk: "#e6f4f5",radius: "8px",dark: false} },
  { id: "T14", name: "Carbon Fiber", blurb: "Near-black with electric blue. Modern and techy.", tokens: {bg: "#101214",solid: "#181b1e",line: "#2a2f34",ink: "#eceff2",muted: "#8f98a1",accent: "#2f8cff",accentInk: "#fff",ok: "#4fd18b",okSoft: "#123222",steel: "#0a0b0c",steelInk: "#d7dce1",radius: "6px",dark: true} },
  { id: "T15", name: "Warm Workshop", blurb: "Warm grey, walnut and copper. Feels like a well-kept shop.", tokens: {bg: "#f3f0ec",solid: "#fffdfa",line: "#e3dbd1",ink: "#2d241e",muted: "#6b5f55",accent: "#b5622c",accentInk: "#fff",ok: "#3d7a4a",okSoft: "#e4f0e5",steel: "#3b2f27",steelInk: "#f1e9df",radius: "4px",dark: false} },
  { id: "T16", name: "Pharma Clean", blurb: "White and mint with navy text, like the cleanrooms your customers run.", tokens: {bg: "#f7fbfa",solid: "#fff",line: "#dcebe6",ink: "#183044",muted: "#5d7182",accent: "#12a37a",accentInk: "#fff",ok: "#12a37a",okSoft: "#e0f4ed",steel: "#ffffff",steelInk: "#183044",radius: "10px",dark: false} },
  { id: "T17", name: "High Contrast", blurb: "Maximum readability in bright plants and for older eyes.", tokens: {bg: "#ffffff",solid: "#fff",line: "#000",ink: "#000",muted: "#333",accent: "#0040c1",accentInk: "#fff",ok: "#006b2d",okSoft: "#d7f5e1",steel: "#000",steelInk: "#fff",radius: "2px",dark: false} },
  { id: "T18", name: "Burgundy Classic", blurb: "Wine red and warm grey. Rich and traditional.", tokens: {bg: "#f5f2f2",solid: "#fff",line: "#e6dcdd",ink: "#2a1d20",muted: "#6c5d60",accent: "#8a1c33",accentInk: "#fff",ok: "#2e7550",okSoft: "#e2f0e7",steel: "#5a1a27",steelInk: "#f6e9ec",radius: "4px",dark: false} },
  { id: "T19", name: "Sky Dashboard", blurb: "Light grey with sky blue and soft shadows. Very modern SaaS.", tokens: {bg: "#f4f7fb",solid: "#fff",line: "#e3e9f1",ink: "#1e2b3c",muted: "#66778c",accent: "#3b82f6",accentInk: "#fff",ok: "#16a34a",okSoft: "#e3f6ea",steel: "#ffffff",steelInk: "#1e2b3c",radius: "12px",dark: false} },
  { id: "T20", name: "Olive Field", blurb: "Olive drab and sand, rugged like field gear.", tokens: {bg: "#f1f0e8",solid: "#fbfaf4",line: "#dddbca",ink: "#262a1e",muted: "#626652",accent: "#c26b16",accentInk: "#fff",ok: "#3e7a3a",okSoft: "#e3efdf",steel: "#3d4430",steelInk: "#ecebdd",radius: "3px",dark: false} },
];

export const THEME_IDS = new Set(THEMES.map((t) => t.id));
export const LAYOUT_IDS = new Set(Array.from({ length: 20 }, (_, i) => `L${i + 1}`));
