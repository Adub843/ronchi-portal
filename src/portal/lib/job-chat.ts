// Each job's discussion thread (Aaron, 2026-11-25): a private chat in the boards table, linked to the job in
// job_chats, so messages, photos and files go through the same chat code and privacy rules as every chat.
//
// Who is in it: the job's field service engineers and the scheduler who made the job, from the moment it is
// first opened. Anyone who schedules jobs joins when they open it from the work order. When a scheduler
// puts an engineer on the job, they join the chat (and see its history, like anyone added to a chat);
// when an engineer is taken off the job, they leave it. Each change shows as a line in the chat.
import { randomId } from "../../shared/crypto";
import type { SessionUser } from "../env";
import { now } from "./db";

const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");

function event(db: D1Database, boardId: string, actorId: string, type: "added" | "removed" | "joined", names: string[], at: string) {
  return db.prepare("INSERT INTO posts (id, board_id, user_id, body, kind, created_at) VALUES (?,?,?,?,'event',?)")
    .bind(randomId(), boardId, actorId, JSON.stringify({ type, names }), at);
}

async function namesOf(db: D1Database, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { results } = await db.prepare(`SELECT name FROM users WHERE id IN (${marks(ids.length)}) ORDER BY name`).bind(...ids).all<{ name: string }>();
  return results.map((r) => r.name);
}

export async function jobChatId(db: D1Database, jobId: string): Promise<string | null> {
  return (await db.prepare("SELECT board_id FROM job_chats WHERE job_id = ?").bind(jobId).first<{ board_id: string }>())?.board_id ?? null;
}

/** The chat's name: "Job J-1042 · Example Foods Inc." (chat names are up to 80 characters). */
export const jobChatName = (job: { job_number: string; customer: string }) => `Job ${job.job_number} · ${job.customer}`.slice(0, 80);

/**
 * Open the job's chat for this person: made the first time, with the job's engineers and its scheduler in it;
 * a person allowed in who isn't yet (another scheduler) joins. Returns the chat's id.
 */
export async function openJobChat(db: D1Database, job: { id: string; job_number: string; customer: string; created_by: string | null }, u: SessionUser): Promise<{ id: string; created: boolean }> {
  const at = now();
  const existing = await jobChatId(db, job.id);
  if (existing) {
    const member = await db.prepare("SELECT 1 FROM board_members WHERE board_id = ? AND user_id = ?").bind(existing, u.id).first();
    if (!member) {
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO board_members (board_id, user_id, added_at) VALUES (?,?,?)").bind(existing, u.id, at),
        event(db, existing, u.id, "joined", [u.name], at),
      ]);
    }
    return { id: existing, created: false };
  }
  const { results } = await db.prepare("SELECT t.user_id FROM job_techs t JOIN users u ON u.id = t.user_id WHERE t.job_id = ? AND u.status = 'active'").bind(job.id).all<{ user_id: string }>();
  const creator = job.created_by ? await db.prepare("SELECT id FROM users WHERE id = ? AND status = 'active'").bind(job.created_by).first<{ id: string }>() : null;
  const people = [...new Set([...results.map((r) => r.user_id), ...(creator ? [creator.id] : []), u.id])];
  const id = randomId();
  const add = db.prepare("INSERT INTO board_members (board_id, user_id, added_at) VALUES (?,?,?)");
  try {
    await db.batch([
      db.prepare("INSERT INTO boards (id, kind, name, description, created_by, created_at) VALUES (?,'chat',?,?,?,?)").bind(id, jobChatName(job), "Job chat", creator?.id ?? u.id, at),
      // The link goes in with the chat, so two people opening it at once can't make two chats.
      db.prepare("INSERT INTO job_chats (job_id, board_id, created_at) VALUES (?,?,?)").bind(job.id, id, at),
      ...people.map((p) => add.bind(id, p, at)),
    ]);
  } catch (e) {
    const again = await jobChatId(db, job.id);
    if (again) return openJobChat(db, job, u);
    throw e;
  }
  return { id, created: true };
}

/** After a scheduler changes a job's engineers: the new ones join its chat and the ones taken off leave (not the job's scheduler). */
export async function syncJobChat(db: D1Database, jobId: string, actor: SessionUser, removed: string[]): Promise<void> {
  const board = await jobChatId(db, jobId);
  if (!board) return; // not opened yet: it is made with the right people the first time
  const job = await db.prepare("SELECT created_by FROM jobs WHERE id = ?").bind(jobId).first<{ created_by: string | null }>();
  const { results: members } = await db.prepare("SELECT user_id FROM board_members WHERE board_id = ?").bind(board).all<{ user_id: string }>();
  const have = new Set(members.map((m) => m.user_id));
  const { results: techs } = await db.prepare("SELECT t.user_id FROM job_techs t JOIN users u ON u.id = t.user_id WHERE t.job_id = ? AND u.status = 'active'").bind(jobId).all<{ user_id: string }>();
  const join = techs.map((t) => t.user_id).filter((x) => !have.has(x));
  const leave = removed.filter((x) => have.has(x) && x !== job?.created_by && !techs.some((t) => t.user_id === x));
  const at = now();
  const stmts: D1PreparedStatement[] = [];
  if (join.length) {
    const add = db.prepare("INSERT OR IGNORE INTO board_members (board_id, user_id, added_at) VALUES (?,?,?)");
    stmts.push(...join.map((x) => add.bind(board, x, at)), event(db, board, actor.id, "added", await namesOf(db, join), at));
  }
  if (leave.length) {
    stmts.push(db.prepare(`DELETE FROM board_members WHERE board_id = ? AND user_id IN (${marks(leave.length)})`).bind(board, ...leave), event(db, board, actor.id, "removed", await namesOf(db, leave), at));
  }
  if (stmts.length) await db.batch(stmts);
}
