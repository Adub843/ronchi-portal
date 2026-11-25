// Software downloads: rules shared by the Worker (the real checks) and the app (grouping, sizes).

/** Each upload piece. Cloudflare takes up to 100 MB per request; the bucket needs every piece but the last to be the same size. */
export const PART_BYTES = 50 * 1024 * 1024;
/** The biggest single file (a full Studio 5000 DVD image is around 10 GB). */
export const MAX_SOFTWARE_BYTES = 50 * 1024 * 1024 * 1024;

/** A file name without folders or characters Windows won't save. */
export function softwareFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "").trim().slice(0, 200);
  return clean && clean !== "." && clean !== ".." ? clean : "file";
}

/**
 * A folder path inside a package, with / between folders ("" = no folder).
 * Backslashes become /, empty parts are dropped. null when it tries to climb out (..), names a drive
 * (C:) or uses characters Windows won't allow, so a saved folder always lands inside the package's folder.
 */
export function cleanFolder(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > 400) return null;
  const parts = value.split(/[\\/]/).map((p) => p.trim()).filter((p) => p && p !== ".");
  // eslint-disable-next-line no-control-regex
  if (parts.some((p) => p === ".." || /[\u0000-\u001f\u007f"<>|:*?]/.test(p) || p.length > 120)) return null;
  if (parts.length > 12) return null;
  return parts.join("/");
}

export interface SoftwareFile { id: string; folder: string; name: string; size: number }
export interface FolderGroup { name: string; files: SoftwareFile[]; size: number }

/**
 * The pop-up's list: one line per top-level folder (everything under it goes with it), then any
 * files that aren't in a folder, one line each under "Files".
 */
export function groupByFolder(files: SoftwareFile[]): { folders: FolderGroup[]; loose: SoftwareFile[] } {
  const map = new Map<string, FolderGroup>();
  const loose: SoftwareFile[] = [];
  for (const f of files) {
    if (!f.folder) { loose.push(f); continue; }
    const top = f.folder.split("/")[0]!;
    const g = map.get(top) ?? { name: top, files: [], size: 0 };
    g.files.push(f);
    g.size += f.size;
    map.set(top, g);
  }
  return { folders: [...map.values()].sort((a, b) => a.name.localeCompare(b.name)), loose: loose.sort((a, b) => a.name.localeCompare(b.name)) };
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * A Ronchi SharePoint file link turned into its direct download address, and the file's name.
 * Takes the three kinds of link people copy: the file's own address, the library page link
 * (…/Forms/AllItems.aspx?id=/sites/…/file.exe) and a sharing link (…/:u:/s/Site/Token).
 * Only https links on a *.sharepoint.com address; null for anything else, and for a folder
 * (no file extension), because a folder can't be downloaded as one link.
 */
export function sharePointLink(input: string): { download: string; name: string | null } | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !/^[a-z0-9-]+\.sharepoint\.com$/i.test(u.hostname) || u.username || u.password) return null;
  // Sharing link: SharePoint downloads it when download=1 is added.
  if (/^\/:[a-z]:\//i.test(u.pathname)) {
    u.searchParams.set("download", "1");
    return { download: u.toString(), name: null };
  }
  let path = u.searchParams.get("id") ?? decodeURIComponent(u.pathname);
  if (!path.startsWith("/sites/") && !path.startsWith("/teams/")) return null;
  if (/\/Forms\/[^/]+\.aspx$/i.test(path) || path.includes("/_layouts/")) return null;
  const name = path.split("/").pop() ?? "";
  if (!/\.[A-Za-z0-9]{1,8}$/.test(name)) return null; // a folder
  const site = path.split("/").slice(0, 3).join("/"); // /sites/HelpReferenceDocuments
  return { download: `https://${u.hostname}${site}/_layouts/15/download.aspx?SourceUrl=${encodeURIComponent(path)}`, name };
}
