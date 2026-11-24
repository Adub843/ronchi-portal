// New-message alerts.
//  - On a computer: a small box pops up at the bottom left when a message arrives while you're
//    on another screen. Click it to open the chat. It goes away by itself after 8 seconds.
//  - Everywhere: unread counts on the Chats and Boards tabs, and in the browser tab's title.
// Muted chats never pop up. Turn pop-ups off in the account menu or Settings.
import { useEffect, useRef, useState } from "react";
import { api, type Me } from "../api";
import { t } from "../i18n";
import { navigate } from "../router";
import { Clip, Close } from "./icons";

export interface Unread { boards: number; chats: number }
interface Update { id: string; board_id: string; body: string; author: string; board_name: string; kind: "board" | "chat"; files: number }

const SOUND_KEY = "ronchi.sound";
export function soundOn(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === "1";
  } catch {
    return false;
  }
}
export function setSound(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? "1" : "0");
  } catch {
    /* fine */
  }
}

let audio: AudioContext | null = null;
/** A short, soft two-note chime made in the browser (no sound file to download). */
function chime() {
  try {
    audio ??= new AudioContext();
    const at = audio.currentTime;
    [880, 1320].forEach((f, i) => {
      const o = audio!.createOscillator();
      const g = audio!.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, at + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.08, at + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + i * 0.12 + 0.25);
      o.connect(g).connect(audio!.destination);
      o.start(at + i * 0.12);
      o.stop(at + i * 0.12 + 0.3);
    });
  } catch {
    /* no sound available */
  }
}

export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase();
}

const BASE_TITLE = "Ronchi Portal";
const READ_EVENT = "ronchi:read";
/** Tell the alerts that something was read, so the unread counts update straight away. */
export const countsChanged = () => window.dispatchEvent(new Event(READ_EVENT));

export function Alerts({ me, path, popups, onUnread }: { me: Me; path: string; popups: boolean; onUnread: (u: Unread) => void }) {
  const [shown, setShown] = useState<Update[]>([]);
  const since = useRef<string | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;
  const popRef = useRef(popups);
  popRef.current = popups;

  useEffect(() => {
    let stop = false;
    let timer: number | undefined;
    async function tick() {
      try {
        const q = since.current ? `?since=${encodeURIComponent(since.current)}` : "";
        const r = await api<{ now: string; posts: Update[]; unread: Unread }>(`/boards/updates${q}`);
        if (stop) return;
        since.current = r.now;
        onUnread(r.unread);
        const total = r.unread.boards + r.unread.chats;
        document.title = total ? `(${total}) ${BASE_TITLE}` : BASE_TITLE;
        const here = pathRef.current;
        // Not while you're on the chat lists or in that chat: you can already see it there.
        const fresh = r.posts.filter((p) => !(here === "/chats" || here === "/boards" || here.endsWith(`/${p.board_id}`)));
        if (fresh.length && popRef.current && document.visibilityState === "visible" && window.matchMedia("(min-width: 641px)").matches) {
          setShown((s) => [...fresh.reverse(), ...s.filter((x) => !fresh.some((f) => f.id === x.id))].slice(0, 3));
          if (soundOn()) chime();
        }
      } catch {
        /* offline or signed out: try again next time */
      }
      // Every 8 seconds while the page is in front, every 30 seconds in the background.
      if (!stop) timer = window.setTimeout(tick, document.visibilityState === "visible" ? 8000 : 30000);
    }
    tick();
    // A chat was just read (or everything marked read): update the counts now, not in 8 seconds.
    const now = () => {
      window.clearTimeout(timer);
      tick();
    };
    window.addEventListener(READ_EVENT, now);
    return () => {
      stop = true;
      window.clearTimeout(timer);
      window.removeEventListener(READ_EVENT, now);
      document.title = BASE_TITLE;
    };
  }, [me.id]);

  if (!shown.length) return null;
  return (
    <div className="alerts" aria-live="polite" aria-label={t("New messages")}>
      {shown.map((p) => (
        <AlertBox key={p.id} p={p} onClose={() => setShown((s) => s.filter((x) => x.id !== p.id))} />
      ))}
    </div>
  );
}

function AlertBox({ p, onClose }: { p: Update; onClose: () => void }) {
  const timer = useRef<number | undefined>(undefined);
  const start = () => (timer.current = window.setTimeout(onClose, 8000));
  useEffect(() => {
    start();
    return () => window.clearTimeout(timer.current);
  }, []);
  const direct = p.kind === "chat" && !p.board_name;
  const title = direct ? p.author : p.board_name;
  const to = `/${p.kind === "chat" ? "chats" : "boards"}/${p.board_id}`;
  return (
    <div className="alert" onMouseEnter={() => window.clearTimeout(timer.current)} onMouseLeave={start}>
      <button type="button" className="alert-open" onClick={() => { onClose(); navigate(to); }}>
        <span className="avatar" aria-hidden="true">{initials(title)}</span>
        <span className="alert-text">
          <b>{title}</b>
          <span>
            {!direct && <>{p.author}: </>}
            {p.files > 0 && <span className="alert-clip"><Clip size={13} /></span>}
            {p.body || t("Sent a photo or file")}
          </span>
          <small>{p.kind === "chat" ? t("Chat") : t("Board")} · {t("Click to open")}</small>
        </span>
      </button>
      <button type="button" className="alert-close" onClick={onClose} aria-label={t("Dismiss")}><Close size={16} /></button>
    </div>
  );
}
