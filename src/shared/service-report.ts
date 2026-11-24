// Reads the machine number and other details from a service report file name.
// Ronchi's reports follow: "SR - <tech> - <project>-<visit> - <machine> - <MM-DD-YY>"
// for example "SR - AL - 26-0326-S1 - 3069MB - 10-19-26.pdf".

export interface ServiceReportName {
  tech: string;
  project: string;
  machine: string;
  date: string | null; // YYYY-MM-DD
}

/** Ronchi machine numbers: four digits then 1 to 3 letters, for example 3069MB or 4222TP. */
export const MACHINE_SERIAL = /\b\d{4}[A-Z]{1,3}\b/;

export function parseServiceReportName(fileName: string): ServiceReportName | null {
  const base = fileName.replace(/\.[a-z0-9]{1,5}$/i, "").trim();
  const parts = base.split(/\s+-\s+/).map((p) => p.trim());
  if (parts.length < 4 || parts[0]?.toUpperCase() !== "SR") return null;
  const machine = parts.find((p, i) => i > 1 && new RegExp(`^${MACHINE_SERIAL.source.slice(2, -2)}$`, "i").test(p));
  if (!machine) return null;
  const last = parts[parts.length - 1] ?? "";
  const m = /^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/.exec(last);
  let date: string | null = null;
  if (m) {
    const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return { tech: parts[1] ?? "", project: parts[2] ?? "", machine: machine.toUpperCase(), date };
}
