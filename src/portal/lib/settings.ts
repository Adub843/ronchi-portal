// The admin controls in Settings: everything an admin can change without touching code.
// Used by the Worker (which stores, checks and enforces them) and by the app (labels, defaults, limits).
//
// Settings are one JSON record in portal-db (table settings, migration 0007). A missing or partly
// filled record is fine: clean() fills every gap with the default below, so new controls can be
// added later without a migration.
//
// HARD RULES stay in code and can't be switched off here (see LOCKED_RULES and roles.ts):
// admins always have every permission, only admins manage people/settings/audit, chats are
// members-only, the customer wall, passkey-only sign-in, and the 25 MB file ceiling.
import type { Permission, Role } from "./roles";
import { DEFAULT_THEME, THEME_IDS } from "../../shared/themes";

export type Lang = "en" | "es" | "it";
export const LANG_IDS: Lang[] = ["en", "es", "it"];

/** Parts of the portal an admin can turn off for everyone else, and the permissions each one covers. */
export const SECTIONS = {
  // A new part of the portal adds one line here: its permissions close to everyone but admins when
  // the owner switches it off in Settings > Command center. `hint` is one optional plain sentence.
  chats: { label: "Chats and boards", perms: ["boards.use", "boards.create", "chats.start", "files.send", "boards.moderate"] },
  jobs: { label: "Jobs (field service scheduling)", perms: ["jobs.view", "jobs.schedule"] },
  machines: { label: "Machines", perms: ["machines.view", "machines.add", "machines.edit"] },
  catalog: { label: "Parts catalog", perms: ["catalog.view", "catalog.edit"] },
  customers: { label: "Customers and quote requests", perms: ["customers.manage", "customers.invite", "quotes.manage"] },
  changeParts: { label: "Change parts", perms: ["orders.view", "orders.add", "orders.edit", "orders.remove", "orders.import"] },
  knowledge: { label: "Knowledge base", perms: ["kb.view", "kb.write", "kb.edit_all", "kb.import", "kb.publish"] },
  software: { label: "Software downloads", perms: ["software.view", "software.manage"] },
} as const satisfies Record<string, { label: string; perms: Permission[]; hint?: string }>;
export type Section = keyof typeof SECTIONS;
export const SECTION_IDS = Object.keys(SECTIONS) as Section[];

/** Limits for the number controls. The upper limits are hard ceilings. */
export const LIMITS = {
  inviteHours: { min: 1, max: 336 },   // 1 hour to 14 days
  sessionDays: { min: 1, max: 90 },
  idleDays: { min: 1, max: 30 },
  chatPeople: { min: 2, max: 50 },
  fileMb: { min: 1, max: 25 },         // 25 MB is the most one file can be (hard rule)
  filesPerMessage: { min: 1, max: 10 },
  notice: 300,
  name: 60,
} as const;

/** Roles a new invite can start with (never admin or manager). Roles themselves are edited on the People page. */
export const STARTING_ROLES: Role[] = ["billing", "scheduling", "service", "sales", "engineering", "tech"];

export interface PortalSettings {
  brand: { name: string; company: string; notice: string };
  people: { inviteHours: number; sessionDays: number; idleDays: number; invitesPaused: boolean; defaultRole: Role };
  sections: Record<Section, boolean>;
  chats: { maxPeople: number; files: boolean; maxFileMb: number; maxFiles: number };
  languages: { allowed: Lang[]; default: Lang };
  look: { defaultTheme: string; allowedThemes: string[]; popupsDefault: boolean };
}

/** The settings anyone signed in may read (to show the right name, notice, languages and limits). */
export type PublicSettings = Pick<PortalSettings, "brand" | "people" | "chats" | "languages" | "look">;

export function defaults(themeIds: string[] = [...THEME_IDS]): PortalSettings {
  return {
    brand: { name: "Ronchi Portal", company: "Ronchi America", notice: "" },
    people: { inviteHours: 72, sessionDays: 30, idleDays: 14, invitesPaused: false, defaultRole: "tech" },
    sections: Object.fromEntries(SECTION_IDS.map((k) => [k, true])) as Record<Section, boolean>, // every part starts on
    chats: { maxPeople: 30, files: true, maxFileMb: 25, maxFiles: 10 },
    languages: { allowed: [...LANG_IDS], default: "en" },
    look: { defaultTheme: DEFAULT_THEME, allowedThemes: themeIds, popupsDefault: true },
  };
}

/** Plain rules that can't be changed in Settings. Shown to admins so they know where the limits are. */
export const LOCKED_RULES = [
  "Admins always have every permission, and only admins can manage people, settings and the activity log.",
  "Nobody can remove their own admin access.",
  "Private chats are members-only. Admins can't read chats they aren't in.",
  "Customers never see the business side. The help center and parts site are separate, with their own data.",
  "Sign-in is with passkeys only (Face ID, fingerprint, Windows Hello). There are no passwords.",
  "Each file can be at most 25 MB, and only safe file types can be sent.",
  "No money amounts or sales totals are shown anywhere in the portal.",
  "The activity log can't be edited or deleted.",
];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Check a settings record and fill gaps with defaults. With strict = true (an admin saving),
 * anything out of range is an error message; otherwise bad values quietly fall back to defaults.
 */
export function clean(
  input: unknown,
  base: PortalSettings,
  strict = false,
): { settings: PortalSettings; error: string | null } {
  let error: string | null = null;
  const bad = (msg: string) => {
    if (strict && !error) error = msg;
  };
  const src = isObj(input) ? input : {};
  const part = (k: string) => (isObj(src[k]) ? (src[k] as Record<string, unknown>) : {});

  const text = (v: unknown, fallback: string, max: number, what: string, allowEmpty = false) => {
    if (v === undefined) return fallback;
    if (typeof v !== "string") return bad(`${what} must be text.`), fallback;
    const t = v.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    if (!t && !allowEmpty) return bad(`${what} can't be empty.`), fallback;
    if (t.length > max) return bad(`${what} is too long (limit ${max} characters).`), fallback;
    return t;
  };
  const num = (v: unknown, fallback: number, lim: { min: number; max: number }, what: string) => {
    if (v === undefined) return fallback;
    const n = typeof v === "string" && v.trim() ? Number(v) : v;
    if (typeof n !== "number" || !Number.isInteger(n) || n < lim.min || n > lim.max) return bad(`${what} must be a whole number from ${lim.min} to ${lim.max}.`), fallback;
    return n;
  };
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

  const b = part("brand");
  const brand = {
    name: text(b.name, base.brand.name, LIMITS.name, "Portal name"),
    company: text(b.company, base.brand.company, LIMITS.name, "Company name"),
    notice: text(b.notice, base.brand.notice, LIMITS.notice, "Notice for everyone", true),
  };

  const p = part("people");
  const people = {
    inviteHours: num(p.inviteHours, base.people.inviteHours, LIMITS.inviteHours, "Invite link lifetime"),
    sessionDays: num(p.sessionDays, base.people.sessionDays, LIMITS.sessionDays, "Stay signed in for"),
    idleDays: num(p.idleDays, base.people.idleDays, LIMITS.idleDays, "Sign out after days unused"),
    invitesPaused: bool(p.invitesPaused, base.people.invitesPaused),
    defaultRole: (typeof p.defaultRole === "string" && STARTING_ROLES.includes(p.defaultRole as Role) ? p.defaultRole : (p.defaultRole !== undefined && bad("Pick a starting role that isn't admin or manager."), base.people.defaultRole)) as Role,
  };
  if (people.idleDays > people.sessionDays) {
    bad("Sign out after days unused can't be longer than stay signed in for.");
    people.idleDays = Math.min(base.people.idleDays, people.sessionDays);
  }

  const s = part("sections");
  const sections = Object.fromEntries(SECTION_IDS.map((k) => [k, bool(s[k], base.sections[k] ?? true)])) as PortalSettings["sections"];

  const ch = part("chats");
  const chats = {
    maxPeople: num(ch.maxPeople, base.chats.maxPeople, LIMITS.chatPeople, "People in one chat"),
    files: bool(ch.files, base.chats.files),
    maxFileMb: num(ch.maxFileMb, base.chats.maxFileMb, LIMITS.fileMb, "Largest file"),
    maxFiles: num(ch.maxFiles, base.chats.maxFiles, LIMITS.filesPerMessage, "Files in one message"),
  } as PortalSettings["chats"];

  const l = part("languages");
  let allowed = base.languages.allowed;
  if (l.allowed !== undefined) {
    if (Array.isArray(l.allowed) && l.allowed.every((x) => LANG_IDS.includes(x as Lang))) allowed = LANG_IDS.filter((x) => (l.allowed as string[]).includes(x) || x === "en");
    else bad("Unknown language.");
  }
  let lang: Lang = LANG_IDS.includes(l.default as Lang) ? (l.default as Lang) : (l.default !== undefined && bad("Unknown language."), base.languages.default);
  if (!allowed.includes(lang)) {
    bad("The starting language has to be one people can pick.");
    lang = "en";
  }

  const lk = part("look");
  const themeIds = base.look.allowedThemes;
  let themes = themeIds;
  if (lk.allowedThemes !== undefined) {
    if (Array.isArray(lk.allowedThemes) && lk.allowedThemes.every((x) => typeof x === "string" && THEME_IDS.has(x))) {
      themes = [...THEME_IDS].filter((x) => (lk.allowedThemes as string[]).includes(x) || x === DEFAULT_THEME);
    } else bad("Unknown theme.");
  }
  let defaultTheme = typeof lk.defaultTheme === "string" && THEME_IDS.has(lk.defaultTheme) ? lk.defaultTheme : (lk.defaultTheme !== undefined && bad("Unknown theme."), base.look.defaultTheme);
  if (!themes.includes(defaultTheme)) {
    bad("The starting look has to be one people can pick.");
    defaultTheme = DEFAULT_THEME;
  }
  const look = { defaultTheme, allowedThemes: themes, popupsDefault: bool(lk.popupsDefault, base.look.popupsDefault) };

  return { settings: { brand, people, sections, chats, languages: { allowed, default: lang }, look }, error };
}

export function publicPart(s: PortalSettings): PublicSettings {
  return { brand: s.brand, people: s.people, chats: s.chats, languages: s.languages, look: s.look };
}
