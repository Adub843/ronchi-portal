// Sending email from the portal, through Cloudflare Email Service (the EMAIL send_email binding).
// Until it's set up (see README, "Job emails"), nothing is sent and the caller hears "not_set_up",
// so the app can offer to send the same email from the scheduler's own email instead.
import type { Env } from "../env";

export type MailResult = "sent" | "not_set_up" | "failed";

export async function sendMail(env: Env, msg: { to: string; subject: string; text: string; html: string; replyTo?: string }): Promise<MailResult> {
  if (!env.EMAIL || !env.MAIL_FROM) return "not_set_up";
  try {
    await env.EMAIL.send({
      from: { email: env.MAIL_FROM, name: "Ronchi Portal" },
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
    });
    return "sent";
  } catch (e) {
    console.error("Email failed", e); // shows in Cloudflare's Workers logs
    return "failed";
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (v: unknown): v is string => typeof v === "string" && v.length <= 200 && EMAIL.test(v);

/** Where a person's job emails go: their notice email, else their login when it is an email. */
export function mailTo(u: { email: string; notify_email: string | null }): string | null {
  if (u.notify_email && isEmail(u.notify_email)) return u.notify_email;
  return isEmail(u.email) ? u.email : null;
}
