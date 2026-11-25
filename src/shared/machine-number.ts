// Machine numbers as Ronchi America writes them: 3069MB (Ronchi Italy: digits then the machine
// type letters; older machines like 3426 or 882MZ have no letters or only three digits) or
// RA1018 / RA1042F (built by Ronchi America).
export const MACHINE_NUMBER = /^(?:[1-9]\d{2,3}[A-Z]{0,3}|RA\d{4}[A-Z]{0,3})$/i;

