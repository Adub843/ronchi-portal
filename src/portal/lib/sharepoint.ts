// The portal reaching SharePoint itself (Aaron, 2026-11-25: "tunnel that file from share point"),
// through Microsoft Graph with an app registered in Ronchi's Microsoft 365 (Entra ID).
//
// It stays off until the three secrets MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET are set
// (docs/SHAREPOINT.md). Until then the portal sends people to SharePoint and their own Microsoft
// sign-in opens the file. Once set, the portal fetches the file with its own app sign-in and
// streams it through, so staff don't need SharePoint access and the pop-up can save whole folders.
import { graphShareId, sharePointTarget } from "../../shared/software";
import type { Env } from "../env";

const GRAPH = "https://graph.microsoft.com/v1.0";
type MsEnv = Pick<Env, "MS_TENANT_ID" | "MS_CLIENT_ID" | "MS_CLIENT_SECRET">;

export function graphConfigured(env: MsEnv): boolean {
  return !!(env.MS_TENANT_ID && env.MS_CLIENT_ID && env.MS_CLIENT_SECRET);
}

let cached: { key: string; token: string; until: number } | null = null;

async function token(env: MsEnv): Promise<string> {
  const key = `${env.MS_TENANT_ID}:${env.MS_CLIENT_ID}`;
  if (cached && cached.key === key && cached.until > Date.now()) return cached.token;
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(env.MS_TENANT_ID!)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.MS_CLIENT_ID!,
      client_secret: env.MS_CLIENT_SECRET!,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Microsoft sign-in failed (${res.status})`);
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Microsoft sign-in gave no token");
  cached = { key, token: data.access_token, until: Date.now() + Math.max(60, (data.expires_in ?? 3600) - 300) * 1000 };
  return data.access_token;
}

async function graph(env: MsEnv, path: string, init: RequestInit = {}): Promise<Response> {
  const t = await token(env);
  return fetch(path.startsWith("https://") ? path : GRAPH + path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${t}` } });
}

/**
 * The file's bytes from SharePoint, or null when it can't be reached (the caller then falls back
 * to sending the person to SharePoint). A Range header is passed on so big downloads can resume.
 */
export async function sharePointDownload(env: MsEnv, sourceUrl: string, range: string | undefined): Promise<Response | null> {
  const target = sharePointTarget(sourceUrl);
  if (!target || target.folder) return null;
  try {
    const res = await graph(env, `/shares/${graphShareId(target.url)}/driveItem/content`, { redirect: "manual" });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    // The location is a short-lived pre-signed link: it must not get our token.
    const file = location ? await fetch(location, { headers: range ? { range } : {} }) : res;
    if (file.status !== 200 && file.status !== 206) return null;
    return file;
  } catch {
    return null;
  }
}

export interface FolderFile { folder: string; name: string; size: number; url: string }

/**
 * Every file inside a SharePoint folder link, with its path below that folder (starting with the
 * folder's own name). Up to `limit` files and 12 levels deep.
 */
export async function sharePointFolder(env: MsEnv, folderUrl: string, limit = 500): Promise<FolderFile[]> {
  const target = sharePointTarget(folderUrl);
  if (!target) throw new Error("not a SharePoint link");
  const res = await graph(env, `/shares/${graphShareId(target.url)}/driveItem?$select=id,name,webUrl,folder,parentReference`);
  if (!res.ok) throw new Error(`SharePoint couldn't find that folder (${res.status})`);
  const root = (await res.json()) as Item & { parentReference?: { driveId?: string } };
  const drive = root.parentReference?.driveId;
  if (!root.folder || !drive) throw new Error("That link isn't a folder");
  const out: FolderFile[] = [];
  const walk = async (item: Item, path: string, depth: number): Promise<void> => {
    let next: string | undefined = `/drives/${encodeURIComponent(drive)}/items/${encodeURIComponent(item.id)}/children?$select=id,name,size,webUrl,file,folder&$top=200`;
    while (next) {
      const page = await graph(env, next);
      if (!page.ok) throw new Error(`SharePoint wouldn't list ${path} (${page.status})`);
      const data = (await page.json()) as { value: Item[]; "@odata.nextLink"?: string };
      for (const child of data.value) {
        if (child.folder) {
          if (depth < 11) await walk(child, `${path}/${child.name}`, depth + 1);
        } else if (child.file) {
          if (out.length >= limit) throw new Error(`That folder has more than ${limit} files. Link its subfolders one at a time.`);
          out.push({ folder: path, name: child.name, size: child.size ?? 0, url: `${item.webUrl}/${encodeURIComponent(child.name)}` });
        }
      }
      next = data["@odata.nextLink"];
    }
  };
  await walk(root, root.name, 0);
  return out;
}

interface Item { id: string; name: string; webUrl: string; size?: number; file?: object; folder?: object }
