// How often the staff app checks the server for new messages and chat changes.
// Every check is one Cloudflare Worker request plus a few database reads, so these numbers drive
// most of the portal's Cloudflare usage. Free plan: 100,000 Worker requests a day for the whole account.
// Rough cost per person: about 4 checks a minute while using the portal, 1 a minute when the page is
// left open untouched, and 1 every 5 minutes for a tab in the background.

export const POLL = {
  /** Page in front and someone used it in the last few minutes. */
  active: 15_000,
  /** Page in front but untouched for `idleAfter`. */
  idle: 60_000,
  /** Tab in the background or the screen is off. */
  hidden: 300_000,
  /** No mouse, key or touch for this long counts as idle. */
  idleAfter: 5 * 60_000,
} as const;

export function pollDelay({ visible, idleMs }: { visible: boolean; idleMs: number }): number {
  if (!visible) return POLL.hidden;
  return idleMs >= POLL.idleAfter ? POLL.idle : POLL.active;
}

/** Fired by the alerts check when new messages arrive, so open chat lists and chats reload once
 *  instead of each asking the server on their own timer. `detail` is the list of board ids. */
export const NEW_POSTS_EVENT = "portal:new-posts";
