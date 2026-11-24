// What a person's login is called: a work email, or just a username such as "AaronL".
// Sign-in itself uses passkeys, so this is only the name the login goes by (and must be unique).

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME = /^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$/; // 3 to 40 letters, digits, dots, dashes or underscores

/** The cleaned login name, or null when it's neither an email nor a username. Emails are lowercased; usernames keep their case. */
export function loginId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (v.includes("@")) return EMAIL.test(v) && v.length <= 200 ? v.toLowerCase() : null;
  return USERNAME.test(v) ? v : null;
}
