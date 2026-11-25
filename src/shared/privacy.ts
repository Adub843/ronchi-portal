// THE WALL, part 1: the check that runs before anything is published to customers.
// It refuses text that contains any customer name, site or machine number.
// Step 2's Publish button calls this; it is here from Step 1 so it is tested from day one.

import { MACHINE_SERIAL } from "./service-report";

export interface PrivateTerms {
  customers: string[];
  sites: string[];
  serials: string[];
}

export interface PrivacyFinding {
  kind: "customer" | "site" | "machine_number";
  match: string;
}

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function scanForCustomerData(text: string, terms: PrivateTerms): PrivacyFinding[] {
  const found: PrivacyFinding[] = [];
  const hay = normalize(text);
  const check = (list: string[], kind: PrivacyFinding["kind"]) => {
    for (const raw of list) {
      const term = normalize(raw.trim());
      if (term.length < 3) continue; // too short to match safely
      const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}($|[^a-z0-9])`, "i");
      if (re.test(hay)) found.push({ kind, match: raw.trim() });
    }
  };
  check(terms.customers, "customer");
  check(terms.sites, "site");
  check(terms.serials, "machine_number");
  // Any machine-number pattern is refused, even one not in the registry yet.
  const generic = new RegExp(`${MACHINE_SERIAL.source}|\\bRA\\d{4}[A-Z]{0,3}\\b`, "gi");
  for (const m of text.matchAll(generic)) {
    if (!found.some((f) => f.match.toLowerCase() === m[0].toLowerCase())) {
      found.push({ kind: "machine_number", match: m[0] });
    }
  }
  return found;
}
