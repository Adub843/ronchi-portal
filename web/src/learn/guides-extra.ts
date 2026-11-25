// Portal training for parts orders, shipping and receiving, and the workbook's
// time sheets and service reports (2026-11-25). Kept in its own file and added to AREAS and GUIDES by guides.ts.
// Same rules as guides.ts: English, Spanish and Italian side by side; say "field service engineer".
import type { Area, Guide, Text } from "./guides";

const T = (en: string, es: string, it: string): Text => ({ en, es, it });

export const EXTRA_AREAS: Area[] = [
  {
    id: "parts-orders", paths: ["/parts-orders"],
    title: T("Parts orders", "Pedidos de piezas", "Ordini ricambi"),
    blurb: T("Spare parts quotes and orders, backorders and the sales tracker.", "Cotizaciones y pedidos de repuestos, pendientes y el seguimiento de ventas.", "Offerte e ordini di ricambi, arretrati e il monitoraggio vendite."),
  },
  {
    id: "shipping", paths: ["/shipping"],
    title: T("Shipping and receiving", "Envíos y recepción", "Spedizioni e ricevimento"),
    blurb: T("What is coming in, what is going out, tracking numbers and where parts are kept.", "Lo que llega, lo que sale, los números de seguimiento y dónde se guardan las piezas.", "Cosa arriva, cosa parte, i numeri di tracciamento e dove sono i ricambi."),
  },
  {
    id: "reports", paths: ["/reports"],
    title: T("Time sheets and reports", "Hojas de horas e informes", "Fogli ore e rapporti"),
    blurb: T("Each field service engineer's time sheet and service report for a job, and approving them.", "La hoja de horas y el informe de servicio de cada ingeniero de servicio de campo, y su aprobación.", "Il foglio ore e il rapporto di assistenza di ogni ingegnere di assistenza sul campo, e la loro approvazione."),
  },
];

export const EXTRA_GUIDES: Guide[] = [
  {
    id: "parts-orders-view", area: "parts-orders", needs: ["psales.view"],
    title: T("Follow parts orders", "Seguir los pedidos de piezas", "Seguire gli ordini ricambi"),
    summary: T("See every spare parts quote and order, what is late and what is waiting on stock.", "Vea cada cotización y pedido de repuestos, lo atrasado y lo que espera existencias.", "Vedi ogni offerta e ordine di ricambi, cosa è in ritardo e cosa attende la merce."),
    steps: [
      T("Open Parts orders from the menu.", "Abra Pedidos de piezas en el menú.", "Apri Ordini ricambi dal menu."),
      T("The numbers at the top filter the list: open quotes, open orders, late, backordered.", "Los números de arriba filtran la lista: cotizaciones abiertas, pedidos abiertos, atrasados, pendientes.", "I numeri in alto filtrano l'elenco: offerte aperte, ordini aperti, in ritardo, arretrati."),
      T("Open an order to see its lines, its customer and machine, and its shipments.", "Abra un pedido para ver sus líneas, su cliente y máquina, y sus envíos.", "Apri un ordine per vederne le righe, il cliente e la macchina, e le spedizioni."),
    ],
  },
  {
    id: "parts-orders-work", area: "parts-orders", needs: ["psales.view", "psales.edit"],
    title: T("Quote and book a parts order", "Cotizar y registrar un pedido de piezas", "Fare un'offerta e registrare un ordine ricambi"),
    summary: T("From the customer's request to a quote, then an order with the customer's PO.", "De la solicitud del cliente a una cotización, y luego a un pedido con la orden de compra del cliente.", "Dalla richiesta del cliente a un'offerta, poi a un ordine con l'ordine d'acquisto del cliente."),
    steps: [
      T("Press New quote, pick the customer and machine, and add the part lines.", "Pulse Nueva cotización, elija el cliente y la máquina, y agregue las líneas de piezas.", "Premi Nuova offerta, scegli cliente e macchina e aggiungi le righe dei ricambi."),
      T("Every change saves as you make it. Set a follow-up date to be reminded.", "Cada cambio se guarda al hacerlo. Ponga una fecha de seguimiento para que se lo recuerde.", "Ogni modifica si salva subito. Imposta una data di richiamo per ricordartelo."),
      T("When the customer sends their PO, press Book order and type the PO number.", "Cuando el cliente envíe su orden de compra, pulse Registrar pedido y escriba el número.", "Quando il cliente manda l'ordine d'acquisto, premi Registra ordine e scrivi il numero."),
    ],
  },
  {
    id: "shipping-view", area: "shipping", needs: ["ship.view"],
    title: T("Find a shipment", "Encontrar un envío", "Trovare una spedizione"),
    summary: T("See what is arriving and leaving, and open the carrier's tracking page.", "Vea lo que llega y sale, y abra la página de seguimiento del transportista.", "Vedi cosa arriva e cosa parte, e apri la pagina di tracciamento del vettore."),
    steps: [
      T("Open Shipping and receiving from the menu.", "Abra Envíos y recepción en el menú.", "Apri Spedizioni e ricevimento dal menu."),
      T("Incoming lists what is on the way to us; Outgoing lists what we are sending.", "Entrantes lista lo que viene hacia nosotros; Salientes lo que enviamos.", "In arrivo elenca cosa sta arrivando; In uscita cosa stiamo spedendo."),
      T("Press a tracking number to open the carrier's own tracking page.", "Pulse un número de seguimiento para abrir la página del transportista.", "Premi un numero di tracciamento per aprire la pagina del vettore."),
    ],
  },
  {
    id: "shipping-work", area: "shipping", needs: ["ship.view", "ship.edit"],
    title: T("Receive and ship", "Recibir y enviar", "Ricevere e spedire"),
    summary: T("Check in what arrived, and pack and ship an order with its tracking number.", "Registre lo que llegó, y empaque y envíe un pedido con su número de seguimiento.", "Registra cosa è arrivato, e imballa e spedisci un ordine con il suo numero di tracciamento."),
    steps: [
      T("To receive: open the incoming shipment, type the quantity that arrived on each line and where it was put.", "Para recibir: abra el envío entrante, escriba la cantidad que llegó en cada línea y dónde se guardó.", "Per ricevere: apri la spedizione in arrivo, scrivi la quantità arrivata su ogni riga e dove è stata messa."),
      T("Note any damage and add photos from your phone.", "Anote cualquier daño y agregue fotos desde su teléfono.", "Annota eventuali danni e aggiungi foto dal telefono."),
      T("To ship: open the order, press Ship, choose the carrier and type the tracking number. The order updates by itself.", "Para enviar: abra el pedido, pulse Enviar, elija el transportista y escriba el número de seguimiento. El pedido se actualiza solo.", "Per spedire: apri l'ordine, premi Spedisci, scegli il vettore e scrivi il numero di tracciamento. L'ordine si aggiorna da solo."),
    ],
  },
  {
    id: "reports-write", area: "jobs", needs: ["jobs.view", "reports.write"], open: "/work-orders",
    title: T("Fill in your time sheet and service report", "Completar su hoja de horas e informe de servicio", "Compilare il foglio ore e il rapporto di assistenza"),
    summary: T("On the job's work order, while you are on site.", "En la orden de trabajo del trabajo, mientras está en sitio.", "Sull'ordine di lavoro dell'intervento, mentre sei in sede."),
    steps: [
      T("Open Work orders and press the job.", "Abra Órdenes de trabajo y pulse el trabajo.", "Apri Ordini di lavoro e premi l'intervento."),
      T("Add each day's hours on the time sheet, and write what you did in the service report. Everything saves as you type.", "Agregue las horas de cada día en la hoja de horas y escriba lo que hizo en el informe. Todo se guarda al escribir.", "Aggiungi le ore di ogni giorno sul foglio ore e scrivi cosa hai fatto nel rapporto. Tutto si salva mentre scrivi."),
      T("When the job is done, press Send for review.", "Cuando termine el trabajo, pulse Enviar a revisión.", "A lavoro finito, premi Invia in revisione."),
    ],
  },
  {
    id: "reports-review", area: "reports", needs: ["reports.review"],
    title: T("Approve time sheets and reports", "Aprobar hojas de horas e informes", "Approvare fogli ore e rapporti"),
    summary: T("Check what the field service engineers sent, and approve it or send it back.", "Revise lo que enviaron los ingenieros de servicio de campo, y apruébelo o devuélvalo.", "Controlla cosa hanno inviato gli ingegneri di assistenza sul campo, e approvalo o rimandalo."),
    steps: [
      T("Open Time sheets and reports from the menu.", "Abra Hojas de horas e informes en el menú.", "Apri Fogli ore e rapporti dal menu."),
      T("Waiting for review is at the top. Open one to read it.", "Lo que espera revisión está arriba. Abra uno para leerlo.", "In attesa di revisione è in alto. Aprine uno per leggerlo."),
      T("Press Approve, or Send back with a note saying what to fix.", "Pulse Aprobar, o Devolver con una nota que diga qué corregir.", "Premi Approva, oppure Rimanda con una nota su cosa correggere."),
    ],
  },
];
