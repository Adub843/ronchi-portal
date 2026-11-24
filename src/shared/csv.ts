// CSV export that is safe to open in Excel.
// A cell starting with = + - @ (or a tab / carriage return) could run as a formula
// when someone opens the file, so those cells get a leading apostrophe.

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (FORMULA_START.test(text)) text = "'" + text;
  if (/[",\n\r]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
  return text;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  // The byte-order mark makes Excel read the file as UTF-8.
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
