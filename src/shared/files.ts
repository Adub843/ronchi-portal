// Which files can be sent in a chat, and how each one is served back.
// Used by the Worker (the real check) and by the app (so people hear "too big" before uploading).
//
// The type a file is served as comes from THIS table, by its extension, never from what the
// browser claimed. Anything not listed (web pages, SVG, scripts, programs) is refused, so a file
// in a chat can never run as code inside the portal.

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file
export const MAX_FILES_PER_MESSAGE = 10;
export const MAX_MESSAGE_BYTES = 90 * 1024 * 1024; // all files in one message together (Cloudflare takes up to 100 MB per request)

export type FileKind = "image" | "pdf" | "doc" | "sheet" | "slides" | "cad" | "video" | "archive" | "text";

const TYPES: Record<string, { type: string; kind: FileKind }> = {
  // Photos. Only these four are shown inside the chat; everything else is a download.
  jpg: { type: "image/jpeg", kind: "image" },
  jpeg: { type: "image/jpeg", kind: "image" },
  png: { type: "image/png", kind: "image" },
  gif: { type: "image/gif", kind: "image" },
  webp: { type: "image/webp", kind: "image" },
  heic: { type: "image/heic", kind: "doc" }, // iPhone photos: most computers can't show them inline
  heif: { type: "image/heif", kind: "doc" },
  pdf: { type: "application/pdf", kind: "pdf" },
  doc: { type: "application/msword", kind: "doc" },
  docx: { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "doc" },
  odt: { type: "application/vnd.oasis.opendocument.text", kind: "doc" },
  rtf: { type: "application/rtf", kind: "doc" },
  xls: { type: "application/vnd.ms-excel", kind: "sheet" },
  xlsx: { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "sheet" },
  xlsm: { type: "application/vnd.ms-excel.sheet.macroEnabled.12", kind: "sheet" },
  ods: { type: "application/vnd.oasis.opendocument.spreadsheet", kind: "sheet" },
  csv: { type: "text/csv; charset=utf-8", kind: "sheet" },
  ppt: { type: "application/vnd.ms-powerpoint", kind: "slides" },
  pptx: { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "slides" },
  txt: { type: "text/plain; charset=utf-8", kind: "text" },
  log: { type: "text/plain; charset=utf-8", kind: "text" },
  dwg: { type: "application/acad", kind: "cad" },
  dxf: { type: "application/dxf", kind: "cad" },
  step: { type: "application/step", kind: "cad" },
  stp: { type: "application/step", kind: "cad" },
  igs: { type: "application/iges", kind: "cad" },
  iges: { type: "application/iges", kind: "cad" },
  stl: { type: "model/stl", kind: "cad" },
  mp4: { type: "video/mp4", kind: "video" },
  mov: { type: "video/quicktime", kind: "video" },
  zip: { type: "application/zip", kind: "archive" },
  "7z": { type: "application/x-7z-compressed", kind: "archive" },
};

export const ACCEPT = Object.keys(TYPES).map((e) => `.${e}`).join(",");

export function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(name);
  return m ? m[1]!.toLowerCase() : "";
}

/** The served type and kind for a file name, or null when that kind of file isn't allowed. */
export function fileInfo(name: string): { type: string; kind: FileKind; ext: string } | null {
  const ext = extOf(name);
  const t = TYPES[ext];
  return t ? { ...t, ext } : null;
}

/** A safe display name: no folders, no control characters, at most 120 characters. */
export function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "").trim();
  if (clean.length <= 120) return clean || "file";
  const ext = extOf(clean);
  return `${clean.slice(0, 115 - ext.length)}….${ext}`.replace(/\.\.+/g, ".");
}

/** Why a file can't be sent, or null when it's fine. */
export function fileProblem(name: string, size: number): string | null {
  if (!fileInfo(name)) return "That kind of file can't be sent. Photos, PDF, Office, CAD, video and zip files are fine.";
  if (size <= 0) return "That file is empty.";
  if (size > MAX_FILE_BYTES) return "Files can be up to 25 MB each.";
  return null;
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
