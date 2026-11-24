// Words used by the catalog viewers, which both the staff app and the customer parts app show.
// English, Spanish and Italian. test/unit/catalog-words.test.ts checks every entry has all three
// and keeps the same {blanks}.
export type Lang = "en" | "es" | "it";

const W = {
  "Drawing": ["Dibujo", "Disegno"],
  "3D": ["3D", "3D"],
  "Parts": ["Piezas", "Ricambi"],
  "Pos.": ["Pos.", "Pos."],
  "Part number": ["Número de pieza", "Codice"],
  "Description": ["Descripción", "Descrizione"],
  "Qty": ["Cant.", "Q.tà"],
  "Wears": ["Desgaste", "Usura"],
  "Wear part: good to keep a spare": ["Pieza de desgaste: conviene tener repuesto", "Parte soggetta a usura: meglio averne una di scorta"],
  "Open assembly": ["Abrir conjunto", "Apri gruppo"],
  "Where used": ["Dónde se usa", "Dove è usato"],
  "Add to cart": ["Añadir al carrito", "Aggiungi al carrello"],
  "Added to cart": ["Añadido al carrito", "Aggiunto al carrello"],
  "Find in this list": ["Buscar en esta lista", "Cerca in questo elenco"],
  "No parts match.": ["Ninguna pieza coincide.", "Nessun ricambio corrisponde."],
  "This drawing has no parts list.": ["Este dibujo no tiene lista de piezas.", "Questo disegno non ha la distinta."],
  "Zoom in": ["Acercar", "Ingrandisci"],
  "Zoom out": ["Alejar", "Riduci"],
  "Fit": ["Ajustar", "Adatta"],
  "Full screen": ["Pantalla completa", "Schermo intero"],
  "Exit full screen": ["Salir de pantalla completa", "Esci da schermo intero"],
  "Loading the drawing…": ["Cargando el dibujo…", "Caricamento del disegno…"],
  "Loading the 3D model…": ["Cargando el modelo 3D…", "Caricamento del modello 3D…"],
  "The drawing couldn't be loaded.": ["No se pudo cargar el dibujo.", "Impossibile caricare il disegno."],
  "The 3D model couldn't be loaded.": ["No se pudo cargar el modelo 3D.", "Impossibile caricare il modello 3D."],
  "This browser can't show 3D. Use the drawing instead.": ["Este navegador no puede mostrar 3D. Use el dibujo.", "Questo browser non mostra il 3D. Usa il disegno."],
  "No drawing for this sheet yet.": ["Aún no hay dibujo para esta hoja.", "Nessun disegno per questa tavola."],
  "Hide": ["Ocultar", "Nascondi"],
  "Isolate": ["Aislar", "Isola"],
  "Show all": ["Mostrar todo", "Mostra tutto"],
  "See-through": ["Transparente", "Trasparente"],
  "Explode": ["Despiece", "Esploso"],
  "Section": ["Sección", "Sezione"],
  "Off": ["No", "No"],
  "Views": ["Vistas", "Viste"],
  "Model tree": ["Árbol del modelo", "Albero del modello"],
  "Iso": ["Iso", "Iso"],
  "Front": ["Frente", "Fronte"],
  "Back": ["Atrás", "Retro"],
  "Left": ["Izquierda", "Sinistra"],
  "Right": ["Derecha", "Destra"],
  "Top": ["Arriba", "Alto"],
  "Bottom": ["Abajo", "Basso"],
  "Clear selection": ["Quitar selección", "Deseleziona"],
  "Selected: {name}": ["Seleccionado: {name}", "Selezionato: {name}"],
  "Not in the parts list": ["No está en la lista de piezas", "Non è nella distinta"],
  "Drag to turn. Right-drag or two fingers to move. Scroll or pinch to zoom. Click a part to select it.": [
    "Arrastre para girar. Botón derecho o dos dedos para mover. Rueda o pellizco para acercar. Haga clic en una pieza para seleccionarla.",
    "Trascina per ruotare. Tasto destro o due dita per spostare. Rotella o pizzico per lo zoom. Clic su un pezzo per selezionarlo.",
  ],
  "Drag to move. Scroll or pinch to zoom. Click a number to find its part.": [
    "Arrastre para mover. Rueda o pellizco para acercar. Haga clic en un número para ver su pieza.",
    "Trascina per spostare. Rotella o pizzico per lo zoom. Clic su un numero per trovare il ricambio.",
  ],
  "Previous sheet": ["Hoja anterior", "Tavola precedente"],
  "Next sheet": ["Hoja siguiente", "Tavola successiva"],
  "Machine components": ["Componentes de la máquina", "Componenti macchina"],
  "Format components": ["Componentes de formato", "Componenti formato"],
  "Elevators": ["Elevadores", "Elevatori"],
  "Kits": ["Kits", "Kit"],
  "Find a drawing": ["Buscar un dibujo", "Cerca un disegno"],
  "No drawings match.": ["Ningún dibujo coincide.", "Nessun disegno corrisponde."],
  "{n} parts": ["{n} piezas", "{n} ricambi"],
  "m": ["m", "m"],
} as const satisfies Record<string, readonly [string, string]>;

export type Word = keyof typeof W;
export const WORDS: Record<string, readonly [string, string]> = W;

/** A word in the given language, with {blanks} filled in. */
export function w(lang: Lang, word: Word, vars?: Record<string, string | number>): string {
  let out: string = lang === "en" ? word : W[word][lang === "es" ? 0 : 1];
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

/** The part name to show: English for English readers, otherwise Italian if there's no translation. */
export function partName(lang: Lang, p: { name_en?: string | null; name_it?: string | null }): string {
  if (lang === "it") return p.name_it || p.name_en || "";
  return p.name_en || p.name_it || "";
}
