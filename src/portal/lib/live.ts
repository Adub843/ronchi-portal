// Live updates: every change made through the API bumps a number for its area (table live_revs,
// migration 0019). Open pages read the numbers on their regular check (the alerts check, or
// GET /api/live for people without chats) and reload only the area that changed. See web/src/live.ts.
// Table live_revs is migration 0019.

/** API areas whose changes other people's open pages should pick up. Anything else (sign-in, own prefs) is ignored. */
const TOPICS: Record<string, string> = {
  boards: "boards", files: "boards", jobs: "jobs", "change-parts": "change-parts", kb: "kb", machines: "machines",
  catalog: "catalog", customers: "customers", quotes: "customers", software: "software", links: "links",
  "parts-orders": "parts-orders", shipping: "shipping", reports: "reports", settings: "settings", switches: "settings", users: "users",
};
export const LIVE_TOPICS = [...new Set(Object.values(TOPICS))];

// Calls that save something only for the person making them, or are a step of a bigger change, so
// nobody else's page needs to reload: marking chats read or muted, privacy-scan and import previews,
// and each piece of a large upload (the upload's last step bumps instead).
const QUIET: RegExp[] = [
  /^\/api\/boards\/(read-all|[^/]+\/(read|mute))$/,
  /^\/api\/kb\/[^/]+\/scan$/,
  /^\/api\/kb\/scan$/,
  /^\/api\/software\/files\/[^/]+\/parts\/\d+$/,
];

/** The area an API path belongs to, or null. "/api/jobs/123" → "jobs". `preview` = an import that was only checked, not saved. */
export function topicFor(path: string, preview = false): string | null {
  if (preview || QUIET.some((r) => r.test(path))) return null;
  const m = /^\/api\/([a-z-]+)/.exec(path);
  return (m && TOPICS[m[1]!]) ?? null;
}

export async function bump(db: D1Database, topic: string, at = new Date().toISOString()): Promise<void> {
  await db.prepare("INSERT INTO live_revs (topic, rev, at) VALUES (?, 1, ?) ON CONFLICT (topic) DO UPDATE SET rev = rev + 1, at = excluded.at").bind(topic, at).run();
}

export async function readRevs(db: D1Database): Promise<Record<string, number>> {
  try {
    const { results } = await db.prepare("SELECT topic, rev FROM live_revs").all<{ topic: string; rev: number }>();
    return Object.fromEntries(results.map((r) => [r.topic, r.rev]));
  } catch {
    return {}; // migration 0019 not applied yet: no live updates, everything else works
  }
}
