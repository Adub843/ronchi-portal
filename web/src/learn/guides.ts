// Portal training: how to use every part of Ronchi Portal.
// (Not the machine Training Center of OPLs and how-tos. That one teaches the machines; this one teaches the portal.)
//
// One guide = one job someone does in the portal. `needs` lists the permissions the job takes,
// the same names as src/portal/lib/roles.ts. A person sees a guide when they have all of them,
// so the training always follows what their role and personal access really allow, including
// roles an admin makes in People > Roles.
//
// ADDING A FEATURE? Add its page to an area below (or a new area) and write a guide for each new
// permission. test/unit/learn.test.ts fails until every permission and every menu page is covered,
// and until each guide has English, Spanish and Italian.
//
// Wording: say "field service engineer", never "tech" or "technician".

export interface Text { en: string; es: string; it: string }

export interface Area {
  id: string;
  /** Menu pages this area teaches. The first one is where "Open the page" goes. */
  paths: string[];
  title: Text;
  blurb: Text;
}

export interface Guide {
  id: string;
  area: string;
  title: Text;
  summary: Text;
  /** Every permission this job takes. Empty = everyone with a login. */
  needs: string[];
  steps: Text[];
  tip?: Text;
  /** Where "Open the page" goes, when it isn't the area's page. */
  open?: string;
}

const T = (en: string, es: string, it: string): Text => ({ en, es, it });

export const AREAS: Area[] = [
  {
    id: "basics", paths: ["/", "/learn", "/settings"],
    title: T("Getting started", "Primeros pasos", "Primi passi"),
    blurb: T(
      "Signing in, finding your way around, and setting up your phone and computer.",
      "Iniciar sesión, moverse por el portal y preparar su teléfono y computadora.",
      "Accedere, muoversi nel portale e preparare telefono e computer.",
    ),
  },
  {
    id: "chats", paths: ["/chats"],
    title: T("Chats", "Chats", "Chat"),
    blurb: T("Private messages with anyone on staff, one to one or in a group.", "Mensajes privados con cualquier persona del personal, uno a uno o en grupo.", "Messaggi privati con chiunque del personale, uno a uno o in gruppo."),
  },
  {
    id: "boards", paths: ["/boards"],
    title: T("Message boards", "Tableros de mensajes", "Bacheche"),
    blurb: T("Team rooms for service, engineering, sales and the office.", "Salas de equipo para servicio, ingeniería, ventas y la oficina.", "Stanze di squadra per assistenza, ingegneria, vendite e ufficio."),
  },
  {
    id: "jobs", paths: ["/jobs", "/work-orders"],
    title: T("Jobs and work orders", "Trabajos y órdenes de trabajo", "Lavori e ordini di lavoro"),
    blurb: T("Field service visits: who is going where, and when, plus the Ronchi workbook's work orders.", "Visitas de servicio de campo: quién va adónde y cuándo, más las órdenes de trabajo del cuaderno de trabajo Ronchi.", "Interventi di assistenza sul campo: chi va dove e quando, più gli ordini di lavoro del quaderno di lavoro Ronchi."),
  },
  {
    id: "kb", paths: ["/kb"],
    title: T("Knowledge base", "Base de conocimientos", "Base di conoscenza"),
    blurb: T(
      "One Point Lessons, how-tos, known issues and quick notes, and publishing to the customer help center.",
      "Lecciones de un punto, instructivos, problemas conocidos y notas rápidas, y publicar en el centro de ayuda para clientes.",
      "Lezioni One Point, istruzioni, problemi noti e note rapide, e pubblicazione nel centro assistenza clienti.",
    ),
  },
  {
    id: "machines", paths: ["/machines"],
    title: T("Machines", "Máquinas", "Macchine"),
    blurb: T("The list of every Ronchi machine in the field, and each machine's page.", "La lista de todas las máquinas Ronchi en campo y la página de cada máquina.", "L'elenco di tutte le macchine Ronchi installate e la pagina di ogni macchina."),
  },
  {
    id: "catalog", paths: ["/catalog"],
    title: T("Parts catalog", "Catálogo de piezas", "Catalogo ricambi"),
    blurb: T("Drawings, 3D models and parts lists, built from each manual and published to customers.", "Dibujos, modelos 3D y listas de piezas, creados desde cada manual y publicados para clientes.", "Disegni, modelli 3D e distinte, creati da ogni manuale e pubblicati per i clienti."),
  },
  {
    id: "customers", paths: ["/customers", "/quotes"],
    title: T("Customers and quotes", "Clientes y cotizaciones", "Clienti e offerte"),
    blurb: T("Customer companies, their logins to the parts site, and the quote requests they send.", "Empresas cliente, sus accesos al sitio de piezas y las solicitudes de cotización que envían.", "Aziende clienti, i loro accessi al sito ricambi e le richieste di offerta che inviano."),
  },
  {
    id: "change-parts", paths: ["/change-parts"],
    title: T("Change-part orders", "Pedidos de cambio de formato", "Ordini cambio formato"),
    blurb: T("Every change-part job, from quote to shipped.", "Cada trabajo de cambio de formato, de la cotización al envío.", "Ogni lavoro di cambio formato, dall'offerta alla spedizione."),
  },
  {
    id: "people", paths: ["/people"],
    title: T("People and access", "Personas y acceso", "Persone e accessi"),
    blurb: T("Adding employees, making roles and deciding what each person can do. Admins only.", "Agregar empleados, crear roles y decidir qué puede hacer cada persona. Solo administradores.", "Aggiungere dipendenti, creare ruoli e decidere cosa può fare ogni persona. Solo amministratori."),
  },
];

export const GUIDES: Guide[] = [
  // ---------- Getting started (everyone) ----------
  {
    id: "sign-in", area: "basics", needs: [],
    title: T("Sign in for the first time", "Iniciar sesión por primera vez", "Accedere la prima volta"),
    summary: T("There's no password. You sign in with a passkey: Face ID, your fingerprint, Windows Hello or your device PIN.", "No hay contraseña. Se entra con una llave de acceso: Face ID, su huella, Windows Hello o el PIN del dispositivo.", "Non c'è password. Si accede con una passkey: Face ID, impronta, Windows Hello o il PIN del dispositivo."),
    steps: [
      T("Open the invite link an admin sent you. It works once, for 3 days.", "Abra el enlace de invitación que le envió un administrador. Funciona una vez, durante 3 días.", "Apri il link di invito che ti ha mandato un amministratore. Funziona una volta, per 3 giorni."),
      T("Press Create my passkey and follow your phone or computer's prompt.", "Pulse Crear mi llave de acceso y siga las indicaciones de su teléfono o computadora.", "Premi Crea la mia passkey e segui le istruzioni del telefono o del computer."),
      T("Next time, open the portal and press Sign in with passkey.", "La próxima vez, abra el portal y pulse Iniciar sesión con llave de acceso.", "La prossima volta apri il portale e premi Accedi con passkey."),
    ],
    tip: T("Lost the link, or it expired? Ask an admin for a new one.", "¿Perdió el enlace o venció? Pida uno nuevo a un administrador.", "Hai perso il link o è scaduto? Chiedine uno nuovo a un amministratore."),
  },
  {
    id: "find-your-way", area: "basics", needs: [],
    title: T("Find your way around", "Moverse por el portal", "Muoversi nel portale"),
    summary: T("The menu shows only the pages your access allows, so two people can see different menus.", "El menú muestra solo las páginas que su acceso permite, así que dos personas pueden ver menús distintos.", "Il menu mostra solo le pagine consentite dal tuo accesso, quindi due persone possono vedere menu diversi."),
    steps: [
      T("On a computer the menu is the bar under the Ronchi logo. On a phone it's the tab bar at the bottom.", "En la computadora el menú es la barra bajo el logo de Ronchi. En el teléfono es la barra de pestañas de abajo.", "Sul computer il menu è la barra sotto il logo Ronchi. Sul telefono è la barra delle schede in basso."),
      T("Every page except Home has a Back button at the top left. It returns to the page you came from.", "Todas las páginas menos Inicio tienen el botón Atrás arriba a la izquierda. Vuelve a la página anterior.", "Ogni pagina tranne la Home ha il pulsante Indietro in alto a sinistra. Torna alla pagina precedente."),
      T("Your name at the top right opens the account menu: language, alerts, Settings, Portal training and Sign out.", "Su nombre arriba a la derecha abre el menú de la cuenta: idioma, avisos, Configuración, Capacitación del portal y Cerrar sesión.", "Il tuo nome in alto a destra apre il menu account: lingua, avvisi, Impostazioni, Formazione sul portale ed Esci."),
      T("A red number next to Chats or Boards is how many messages you haven't read.", "Un número rojo junto a Chats o Tableros indica cuántos mensajes no ha leído.", "Un numero rosso accanto a Chat o Bacheche indica quanti messaggi non hai letto."),
    ],
    tip: T("Missing a page you need? Ask an admin to change your access.", "¿Le falta una página que necesita? Pida a un administrador que cambie su acceso.", "Ti manca una pagina che ti serve? Chiedi a un amministratore di cambiare il tuo accesso."),
  },
  {
    id: "add-device", area: "basics", needs: [], open: "/settings",
    title: T("Add your phone or another computer", "Agregar su teléfono u otra computadora", "Aggiungere il telefono o un altro computer"),
    summary: T("Each phone or computer gets its own passkey. Add it from a device that's already signed in.", "Cada teléfono o computadora tiene su propia llave de acceso. Agréguelo desde un dispositivo que ya tenga la sesión iniciada.", "Ogni telefono o computer ha la sua passkey. Aggiungilo da un dispositivo già collegato."),
    steps: [
      T("On the device you're signed in on, open Settings and find Your devices.", "En el dispositivo donde ya inició sesión, abra Configuración y busque Sus dispositivos.", "Sul dispositivo già collegato apri Impostazioni e cerca I tuoi dispositivi."),
      T("Press Add a phone or computer and copy the link.", "Pulse Agregar un teléfono o computadora y copie el enlace.", "Premi Aggiungi un telefono o computer e copia il link."),
      T("Open the link on the new device within 1 hour and create a passkey there.", "Abra el enlace en el dispositivo nuevo antes de 1 hora y cree allí una llave de acceso.", "Apri il link sul nuovo dispositivo entro 1 ora e crea lì una passkey."),
    ],
  },
  {
    id: "lost-device", area: "basics", needs: [], open: "/settings",
    title: T("Sign out a lost phone", "Cerrar la sesión de un teléfono perdido", "Disconnettere un telefono perso"),
    summary: T("If a phone or computer is lost or replaced, take its sign-in away.", "Si pierde o cambia un teléfono o computadora, quítele el acceso.", "Se un telefono o computer è perso o sostituito, togli il suo accesso."),
    steps: [
      T("Open Settings and find Your devices.", "Abra Configuración y busque Sus dispositivos.", "Apri Impostazioni e cerca I tuoi dispositivi."),
      T("Press Sign out next to the device you lost.", "Pulse Cerrar sesión junto al dispositivo perdido.", "Premi Esci accanto al dispositivo perso."),
    ],
    tip: T("No other device to sign in with? Ask an admin to sign you out everywhere and send a new invite.", "¿No tiene otro dispositivo? Pida a un administrador que cierre su sesión en todas partes y le envíe una invitación nueva.", "Nessun altro dispositivo? Chiedi a un amministratore di disconnetterti ovunque e mandarti un nuovo invito."),
  },
  {
    id: "language-look", area: "basics", needs: [], open: "/settings",
    title: T("Change language, colors and light or dark", "Cambiar idioma, colores y modo claro u oscuro", "Cambiare lingua, colori e modalità chiara o scura"),
    summary: T("Your choices are saved to your login, so they follow you to every device.", "Sus elecciones se guardan en su cuenta y le siguen en todos sus dispositivos.", "Le tue scelte sono salvate nel tuo accesso e ti seguono su ogni dispositivo."),
    steps: [
      T("Pick English, Español or Italiano in the account menu, or under Language in Settings.", "Elija English, Español o Italiano en el menú de la cuenta, o en Idioma dentro de Configuración.", "Scegli English, Español o Italiano nel menu account, o in Lingua dentro Impostazioni."),
      T("Under Your look, pick a look, or press Shuffle. Reset to Ronchi goes back to the standard look.", "En Su apariencia, elija una, o pulse Al azar. Volver a Ronchi regresa a la apariencia estándar.", "In Il tuo aspetto scegline uno, o premi Casuale. Torna a Ronchi riporta all'aspetto standard."),
      T("Under Light or dark, pick Light, Dark or Match my device.", "En Claro u oscuro, elija Claro, Oscuro o Igual que mi dispositivo.", "In Chiaro o scuro scegli Chiaro, Scuro o Come il dispositivo."),
    ],
    tip: T("Messages are never translated. They always show exactly as people wrote them.", "Los mensajes nunca se traducen. Siempre se ven tal como se escribieron.", "I messaggi non vengono mai tradotti. Si vedono sempre come sono stati scritti."),
  },
  {
    id: "alerts", area: "basics", needs: [], open: "/settings",
    title: T("Choose your message alerts", "Elegir los avisos de mensajes", "Scegliere gli avvisi dei messaggi"),
    summary: T("Pop-ups and a sound tell you when a message arrives while you're on another page.", "Las ventanas emergentes y un sonido le avisan cuando llega un mensaje mientras está en otra página.", "Finestre a comparsa e un suono ti avvisano quando arriva un messaggio mentre sei su un'altra pagina."),
    steps: [
      T("In the account menu, tick or untick Pop-up alerts on this computer and Alert sound.", "En el menú de la cuenta, marque o desmarque Avisos emergentes en esta computadora y Sonido de aviso.", "Nel menu account spunta o togli Avvisi a comparsa su questo computer e Suono degli avvisi."),
      T("To quiet one chat or board, open it, open its menu and choose Mute alerts.", "Para silenciar un chat o tablero, ábralo, abra su menú y elija Silenciar avisos.", "Per silenziare una chat o bacheca, aprila, apri il suo menu e scegli Disattiva avvisi."),
      T("Mark all chats and boards read, in the account menu, clears every red number at once.", "Marcar todos los chats y tableros como leídos, en el menú de la cuenta, borra todos los números rojos de una vez.", "Segna come lette tutte le chat e bacheche, nel menu account, azzera tutti i numeri rossi."),
    ],
  },
  {
    id: "hide-tips", area: "basics", needs: [], open: "/settings",
    title: T("Hide instruction notes you've read", "Ocultar las notas de instrucciones que ya leyó", "Nascondere le note di istruzioni già lette"),
    summary: T("Grey instruction notes on each page have a small × to close them.", "Las notas grises de instrucciones de cada página tienen una pequeña × para cerrarlas.", "Le note grigie di istruzioni in ogni pagina hanno una piccola × per chiuderle."),
    steps: [
      T("Press the × next to a note. It stays closed on your phone and computer.", "Pulse la × junto a una nota. Queda cerrada en su teléfono y computadora.", "Premi la × accanto a una nota. Resta chiusa su telefono e computer."),
      T("To bring them all back, open Settings and press Show hidden tips under Your look.", "Para recuperarlas todas, abra Configuración y pulse Mostrar notas ocultas en Su apariencia.", "Per farle tornare tutte, apri Impostazioni e premi Mostra note nascoste in Il tuo aspetto."),
    ],
  },
  {
    id: "use-training", area: "basics", needs: [], open: "/learn",
    title: T("Use this training", "Usar esta capacitación", "Usare questa formazione"),
    summary: T("For me shows only what your access allows. By function shows every part of the portal.", "Para mí muestra solo lo que su acceso permite. Por función muestra todas las partes del portal.", "Per me mostra solo ciò che il tuo accesso consente. Per funzione mostra tutte le parti del portale."),
    steps: [
      T("Open a guide to see its steps, then press Open the page to try it.", "Abra una guía para ver sus pasos y pulse Abrir la página para probarlo.", "Apri una guida per vedere i passaggi, poi premi Apri la pagina per provare."),
      T("Press Mark as done when you've learned it. Your progress is kept on this device.", "Pulse Marcar como hecho cuando lo haya aprendido. Su avance se guarda en este dispositivo.", "Premi Segna come fatto quando l'hai imparato. I progressi restano su questo dispositivo."),
      T("Use the search box to find a guide by any word.", "Use el cuadro de búsqueda para encontrar una guía por cualquier palabra.", "Usa la casella di ricerca per trovare una guida con qualsiasi parola."),
    ],
    tip: T("Admins also get By role, to see what any role, including new ones, can do.", "Los administradores tienen además Por rol, para ver qué puede hacer cualquier rol, incluso los nuevos.", "Gli amministratori hanno anche Per ruolo, per vedere cosa può fare qualsiasi ruolo, anche quelli nuovi."),
  },

  // ---------- Chats ----------
  {
    id: "read-chats", area: "chats", needs: ["boards.use"],
    title: T("Read and answer chats", "Leer y responder chats", "Leggere e rispondere alle chat"),
    summary: T("Chats are private: only the people in a chat can read it, admins included.", "Los chats son privados: solo las personas del chat pueden leerlo, incluidos los administradores.", "Le chat sono private: solo chi è nella chat può leggerla, amministratori compresi."),
    steps: [
      T("Open Chats and pick a conversation. Unread ones show a red number.", "Abra Chats y elija una conversación. Las no leídas muestran un número rojo.", "Apri Chat e scegli una conversazione. Quelle non lette hanno un numero rosso."),
      T("Type in the Message box and press Send.", "Escriba en el cuadro Mensaje y pulse Enviar.", "Scrivi nella casella Messaggio e premi Invia."),
      T("Tap or click a message for Reply, Copy, Edit (your own) or Remove.", "Toque o haga clic en un mensaje para Responder, Copiar, Editar (los suyos) o Eliminar.", "Tocca o fai clic su un messaggio per Rispondi, Copia, Modifica (i tuoi) o Rimuovi."),
      T("Use the chat's menu to search in the chat, see its photos and files, or export it as a .txt file.", "Use el menú del chat para buscar en él, ver sus fotos y archivos o exportarlo como archivo .txt.", "Usa il menu della chat per cercare, vedere foto e file o esportarla in un file .txt."),
    ],
  },
  {
    id: "start-chat", area: "chats", needs: ["boards.use", "chats.start"],
    title: T("Start a private or group chat", "Iniciar un chat privado o grupal", "Iniziare una chat privata o di gruppo"),
    summary: T("Talk with one person, or a group such as an install crew.", "Hable con una persona o con un grupo, como un equipo de instalación.", "Parla con una persona o con un gruppo, come una squadra di installazione."),
    steps: [
      T("Open Chats and press New chat.", "Abra Chats y pulse Nuevo chat.", "Apri Chat e premi Nuova chat."),
      T("Search for and tick the people you want.", "Busque y marque a las personas que quiere.", "Cerca e spunta le persone che vuoi."),
      T("For one person press Start chat. For more, add a group name if you like and press Start group chat.", "Para una persona pulse Iniciar chat. Para varias, ponga un nombre de grupo si quiere y pulse Iniciar chat grupal.", "Per una persona premi Inizia chat. Per più persone, dai un nome al gruppo se vuoi e premi Inizia chat di gruppo."),
    ],
    tip: T("Without this access you can still answer chats other people add you to.", "Sin este acceso puede responder igualmente los chats en los que otros le agreguen.", "Senza questo accesso puoi comunque rispondere alle chat in cui altri ti aggiungono."),
  },
  {
    id: "manage-chat", area: "chats", needs: ["boards.use"],
    title: T("Add people, rename or leave a group chat", "Agregar personas, renombrar o salir de un chat grupal", "Aggiungere persone, rinominare o lasciare una chat di gruppo"),
    summary: T("Change who's in a group, or step out of it.", "Cambie quién está en un grupo o salga de él.", "Cambia chi è nel gruppo, o esci."),
    steps: [
      T("Open the chat and press its title, or open its menu, to see People in this chat.", "Abra el chat y pulse su título, o abra su menú, para ver Personas en este chat.", "Apri la chat e premi il titolo, o apri il suo menu, per vedere Persone in questa chat."),
      T("Press Add people to bring someone into a group. They'll see the messages and files already there.", "Pulse Agregar personas para sumar a alguien a un grupo. Verá los mensajes y archivos que ya hay.", "Premi Aggiungi persone per far entrare qualcuno in un gruppo. Vedrà i messaggi e i file già presenti."),
      T("In a group, Leave chat steps you out. The person who started the group can also use Rename group.", "En un grupo, Salir del chat le saca de él. Quien inició el grupo también puede usar Cambiar nombre del grupo.", "In un gruppo, Esci dalla chat ti fa uscire. Chi ha iniziato il gruppo può anche usare Rinomina gruppo."),
    ],
    tip: T("Adding people to a one-to-one chat starts a new group. The one-to-one messages stay private.", "Agregar personas a un chat uno a uno inicia un grupo nuevo. Los mensajes uno a uno siguen privados.", "Aggiungere persone a una chat uno a uno crea un nuovo gruppo. I messaggi uno a uno restano privati."),
  },
  {
    id: "send-files", area: "chats", needs: ["boards.use", "files.send"],
    title: T("Send photos and files", "Enviar fotos y archivos", "Inviare foto e file"),
    summary: T("Send pictures from site, PDFs, Office files, CAD, video and zip files, in chats and boards.", "Envíe fotos del sitio, PDF, archivos de Office, CAD, video y zip, en chats y tableros.", "Invia foto dal cantiere, PDF, file Office, CAD, video e zip, in chat e bacheche."),
    steps: [
      T("In a chat or board, press Attach photos or files, or Take a photo on a phone.", "En un chat o tablero, pulse Adjuntar fotos o archivos, o Tomar una foto en el teléfono.", "In una chat o bacheca premi Allega foto o file, o Scatta una foto dal telefono."),
      T("On a computer you can also drag files onto the conversation.", "En la computadora también puede arrastrar archivos a la conversación.", "Sul computer puoi anche trascinare i file nella conversazione."),
      T("Add a message if you like and press Send.", "Agregue un mensaje si quiere y pulse Enviar.", "Aggiungi un messaggio se vuoi e premi Invia."),
    ],
    tip: T("Each file can be up to 25 MB. Too big together? Send them in two messages.", "Cada archivo puede pesar hasta 25 MB. ¿Demasiado juntos? Envíelos en dos mensajes.", "Ogni file può pesare fino a 25 MB. Troppo grandi insieme? Inviali in due messaggi."),
  },

  // ---------- Boards ----------
  {
    id: "use-boards", area: "boards", needs: ["boards.use"],
    title: T("Read and post on a board", "Leer y publicar en un tablero", "Leggere e scrivere in una bacheca"),
    summary: T("Boards are shared rooms for a team, a machine or an order.", "Los tableros son salas compartidas para un equipo, una máquina o un pedido.", "Le bacheche sono stanze condivise per una squadra, una macchina o un ordine."),
    steps: [
      T("Open Boards and pick one. You see the boards that are open to you.", "Abra Tableros y elija uno. Verá los tableros abiertos para usted.", "Apri Bacheche e scegline una. Vedi le bacheche aperte a te."),
      T("Type a message and press Send. Tap a message to reply to it.", "Escriba un mensaje y pulse Enviar. Toque un mensaje para responderlo.", "Scrivi un messaggio e premi Invia. Tocca un messaggio per rispondere."),
      T("Pinned messages stay at the top. Some boards are Announcements only, where only the creator and moderators post.", "Los mensajes fijados quedan arriba. Algunos tableros son Solo anuncios, donde solo publican el creador y los moderadores.", "I messaggi fissati restano in alto. Alcune bacheche sono Solo annunci: scrivono solo il creatore e i moderatori."),
      T("The board's menu has the same search, photos and files, and mute as a chat.", "El menú del tablero tiene la misma búsqueda, fotos y archivos, y silencio que un chat.", "Il menu della bacheca ha la stessa ricerca, foto e file, e silenzio di una chat."),
    ],
  },
  {
    id: "create-board", area: "boards", needs: ["boards.use", "boards.create"],
    title: T("Start a new board", "Crear un tablero nuevo", "Creare una nuova bacheca"),
    summary: T("Make a board for a team, a machine like 3069MB capper, or an order.", "Cree un tablero para un equipo, una máquina como la taponadora 3069MB, o un pedido.", "Crea una bacheca per una squadra, una macchina come la tappatrice 3069MB, o un ordine."),
    steps: [
      T("Open Boards and press New board.", "Abra Tableros y pulse Nuevo tablero.", "Apri Bacheche e premi Nuova bacheca."),
      T("Type a board name and, if you like, what it's for.", "Escriba el nombre del tablero y, si quiere, para qué es.", "Scrivi il nome della bacheca e, se vuoi, a cosa serve."),
      T("Under Who can see it, tick roles or people, or leave all unticked for everyone on staff.", "En Quién puede verlo, marque roles o personas, o deje todo sin marcar para todo el personal.", "In Chi può vederla spunta ruoli o persone, o lascia tutto vuoto per tutto il personale."),
      T("Press Create board. As its creator you can change it later with Edit board.", "Pulse Crear tablero. Como creador puede cambiarlo después con Editar tablero.", "Premi Crea bacheca. Come creatore puoi cambiarla dopo con Modifica bacheca."),
    ],
    tip: T("On a board you started you can also pin and remove posts, set Announcements only and archive it, like a moderator.", "En un tablero que usted creó también puede fijar y eliminar publicaciones, poner Solo anuncios y archivarlo, como un moderador.", "In una bacheca creata da te puoi anche fissare e rimuovere messaggi, impostare Solo annunci e archiviarla, come un moderatore."),
  },
  {
    id: "moderate-boards", area: "boards", needs: ["boards.use", "boards.moderate"],
    title: T("Moderate boards", "Moderar tableros", "Moderare le bacheche"),
    summary: T("Keep boards tidy: pin, lock, archive and remove anyone's post.", "Mantenga los tableros en orden: fijar, bloquear, archivar y eliminar publicaciones de cualquiera.", "Tieni in ordine le bacheche: fissa, blocca, archivia e rimuovi i messaggi di chiunque."),
    steps: [
      T("Tap any message to Pin it or Remove it.", "Toque cualquier mensaje para Fijarlo o Eliminarlo.", "Tocca un messaggio per Fissarlo o Rimuoverlo."),
      T("In a board's menu, tick Announcements only so only you and moderators can post.", "En el menú del tablero, marque Solo anuncios para que solo usted y los moderadores publiquen.", "Nel menu della bacheca spunta Solo annunci perché scrivano solo tu e i moderatori."),
      T("Archive board hides it from everyone's list. Archived boards, on the Boards page, lets you Restore it.", "Archivar tablero lo oculta de todas las listas. Tableros archivados, en la página Tableros, permite Restaurarlo.", "Archivia bacheca la nasconde a tutti. Bacheche archiviate, nella pagina Bacheche, permette di Ripristinarla."),
    ],
  },

  // ---------- Jobs and work orders ----------
  {
    id: "see-jobs", area: "jobs", needs: ["jobs.view"],
    title: T("See your jobs and get to site", "Ver sus trabajos y llegar al sitio", "Vedere i tuoi lavori e arrivare in cantiere"),
    summary: T("Every field service visit, with the days, the address, the point of contact and the files.", "Cada visita de servicio de campo, con los días, la dirección, el contacto y los archivos.", "Ogni intervento di assistenza sul campo, con giorni, indirizzo, referente e file."),
    steps: [
      T("Open Jobs. Search by job number, customer, machine or address.", "Abra Trabajos. Busque por número de trabajo, cliente, máquina o dirección.", "Apri Lavori. Cerca per numero di lavoro, cliente, macchina o indirizzo."),
      T("Press a job to see its days of work, field service engineers, point of contact and other information.", "Pulse un trabajo para ver sus días, ingenieros de servicio de campo, contacto y otra información.", "Premi un lavoro per vedere giorni, ingegneri di assistenza sul campo, referente e altre informazioni."),
      T("Under Location, press Google Maps, Waze or Apple Maps to get directions.", "En Ubicación, pulse Google Maps, Waze o Apple Maps para llegar.", "In Sede premi Google Maps, Waze o Apple Maps per le indicazioni."),
      T("Under Files, press Add files to attach service reports, photos and drawings.", "En Archivos, pulse Añadir archivos para adjuntar informes de servicio, fotos y dibujos.", "In File premi Aggiungi file per allegare rapporti di assistenza, foto e disegni."),
    ],
    tip: T("You get an email with a link when you're put on a job, and again if its days, location or contact change.", "Recibe un correo con un enlace cuando le asignan a un trabajo, y otro si cambian los días, la ubicación o el contacto.", "Ricevi un'email con un link quando vieni assegnato a un lavoro, e di nuovo se cambiano giorni, posizione o referente."),
  },
  {
    id: "schedule-job", area: "jobs", needs: ["jobs.view", "jobs.schedule"],
    title: T("Schedule a job", "Programar un trabajo", "Programmare un lavoro"),
    summary: T("Set up a visit, pick the field service engineers and email them the details.", "Prepare una visita, elija a los ingenieros de servicio de campo y envíeles los datos por correo.", "Prepara un intervento, scegli gli ingegneri di assistenza sul campo e mandagli i dettagli via email."),
    steps: [
      T("Open Jobs and press Schedule a job.", "Abra Trabajos y pulse Programar un trabajo.", "Apri Lavori e premi Programma un lavoro."),
      T("Fill in the job number, customer, machine number, customer location and point of contact.", "Complete número de trabajo, cliente, número de máquina, ubicación del cliente y contacto.", "Compila numero di lavoro, cliente, numero macchina, posizione del cliente e referente."),
      T("Add the days of work one at a time, or pick From and To and press Add these days.", "Añada los días uno por uno, o elija Desde y Hasta y pulse Añadir estos días.", "Aggiungi i giorni uno alla volta, o scegli Da e A e premi Aggiungi questi giorni."),
      T("Tick the field service engineers, add other information, and press Schedule and email the field service engineers.", "Marque a los ingenieros de servicio de campo, agregue otra información y pulse Programar y enviar correo a los ingenieros de servicio de campo.", "Spunta gli ingegneri di assistenza sul campo, aggiungi altre informazioni e premi Programma e invia l'email agli ingegneri di assistenza sul campo."),
    ],
    tip: T("If portal email isn't set up yet, use Send it from my email on the job to send the same message yourself.", "Si el correo del portal aún no está listo, use Enviarlo desde mi correo en el trabajo para enviar el mismo mensaje usted.", "Se l'email del portale non è ancora attiva, usa Inviala dalla mia email nel lavoro per mandare tu lo stesso messaggio."),
  },
  {
    id: "work-orders", area: "jobs", needs: ["jobs.view"], open: "/work-orders",
    title: T("Use work orders and the machine's log", "Usar las órdenes de trabajo y el historial de la máquina", "Usare gli ordini di lavoro e lo storico della macchina"),
    summary: T("The Ronchi workbook: the current work order plus every past work order for the same machine.", "El cuaderno de trabajo Ronchi: la orden de trabajo actual y todas las anteriores de la misma máquina.", "Il quaderno di lavoro Ronchi: l'ordine di lavoro attuale e tutti quelli passati della stessa macchina."),
    steps: [
      T("Open Work orders, or press Open work order on a job.", "Abra Órdenes de trabajo, o pulse Abrir orden de trabajo en un trabajo.", "Apri Ordini di lavoro, o premi Apri ordine di lavoro in un lavoro."),
      T("Read the past work orders, quick notes and change-part orders for that machine before you go.", "Lea las órdenes anteriores, notas rápidas y pedidos de cambio de formato de esa máquina antes de ir.", "Leggi gli ordini passati, le note rapide e gli ordini cambio formato di quella macchina prima di partire."),
      T("Use Print or save as PDF, or Download the log (CSV).", "Use Imprimir o guardar como PDF, o Descargar el registro (CSV).", "Usa Stampa o salva in PDF, o Scarica il registro (CSV)."),
    ],
    tip: T("If an admin switches the Ronchi workbook off, Work orders leaves the menu but jobs keep working.", "Si un administrador apaga el cuaderno de trabajo Ronchi, Órdenes de trabajo sale del menú pero los trabajos siguen funcionando.", "Se un amministratore spegne il quaderno di lavoro Ronchi, Ordini di lavoro sparisce dal menu ma i lavori continuano a funzionare."),
  },

  // ---------- Knowledge base ----------
  {
    id: "search-kb", area: "kb", needs: ["kb.view"],
    title: T("Find an answer in the knowledge base", "Encontrar una respuesta en la base de conocimientos", "Trovare una risposta nella base di conoscenza"),
    summary: T("Search One Point Lessons, how-tos, known issues and quick notes by the problem, the fix, a machine or a customer.", "Busque lecciones de un punto, instructivos, problemas conocidos y notas rápidas por el problema, la solución, una máquina o un cliente.", "Cerca Lezioni One Point, istruzioni, problemi noti e note rapide per problema, soluzione, macchina o cliente."),
    steps: [
      T("Open Knowledge base and type any words. Any word counts; the best matches come first.", "Abra Base de conocimientos y escriba cualquier palabra. Cuenta cualquier palabra; los mejores resultados salen primero.", "Apri Base di conoscenza e scrivi qualsiasi parola. Conta ogni parola; i risultati migliori vengono prima."),
      T("Type a machine number like 3979MB to get its notes first, then documents for its machine type.", "Escriba un número de máquina como 3979MB para ver primero sus notas y luego los documentos de su tipo de máquina.", "Scrivi un numero macchina come 3979MB per vedere prima le sue note, poi i documenti del suo tipo di macchina."),
      T("Use Filters to narrow by document type, machine, category or who sees it.", "Use Filtros para acotar por tipo de documento, máquina, categoría o quién lo ve.", "Usa Filtri per restringere per tipo di documento, macchina, categoria o chi lo vede."),
    ],
  },
  {
    id: "quick-note", area: "kb", needs: ["kb.view", "kb.write"],
    title: T("Add a quick note from the field", "Agregar una nota rápida desde campo", "Aggiungere una nota rapida dal campo"),
    summary: T("A short Issue and Fix, so the next field service engineer who hits it finds the answer.", "Un Problema y una Solución breves, para que el próximo ingeniero de servicio de campo que lo encuentre tenga la respuesta.", "Un breve Problema e Soluzione, perché il prossimo ingegnere di assistenza sul campo che lo incontra trovi la risposta."),
    steps: [
      T("Open Knowledge base and press Add a quick note.", "Abra Base de conocimientos y pulse Agregar una nota rápida.", "Apri Base di conoscenza e premi Aggiungi una nota rapida."),
      T("Give it a title, the machine number and a category (or Choose for me).", "Póngale un título, el número de máquina y una categoría (o Elegir por mí).", "Dagli un titolo, il numero macchina e una categoria (o Scegli per me)."),
      T("Under Issue write what you saw; under Fix write what fixed it, step by step.", "En Problema escriba lo que vio; en Solución, lo que lo arregló, paso a paso.", "In Problema scrivi cosa hai visto; in Soluzione cosa l'ha risolto, passo per passo."),
      T("Press Save quick note.", "Pulse Guardar nota rápida.", "Premi Salva nota rapida."),
    ],
    tip: T("The machine number is staff only and is never shown to customers.", "El número de máquina es solo para el personal y nunca se muestra a clientes.", "Il numero macchina è solo per il personale e non viene mai mostrato ai clienti."),
  },
  {
    id: "new-article", area: "kb", needs: ["kb.view", "kb.write"],
    title: T("Write an article", "Escribir un artículo", "Scrivere un articolo"),
    summary: T("A longer how-to, known issue or reference, with a summary and details.", "Un instructivo, problema conocido o referencia más largo, con resumen y detalles.", "Un'istruzione, problema noto o riferimento più lungo, con riepilogo e dettagli."),
    steps: [
      T("Open Knowledge base and press New article.", "Abra Base de conocimientos y pulse Nuevo artículo.", "Apri Base di conoscenza e premi Nuovo articolo."),
      T("Pick the type, title, machine type and category.", "Elija el tipo, título, tipo de máquina y categoría.", "Scegli tipo, titolo, tipo di macchina e categoria."),
      T("Under Who sees it, choose Staff only or customers. Customer articles can later be published to the help center.", "En Quién lo ve, elija Solo personal o clientes. Los artículos para clientes se pueden publicar después en el centro de ayuda.", "In Chi lo vede scegli Solo personale o clienti. Gli articoli per i clienti si possono poi pubblicare nel centro assistenza."),
      T("Fill in the summary, issue, fix and details, then press Save article. Use Edit to change your own later.", "Complete resumen, problema, solución y detalles, y pulse Guardar artículo. Use Editar para cambiar los suyos después.", "Compila riepilogo, problema, soluzione e dettagli, poi premi Salva articolo. Usa Modifica per cambiare i tuoi in seguito."),
    ],
  },
  {
    id: "edit-any-article", area: "kb", needs: ["kb.view", "kb.write", "kb.edit_all"],
    title: T("Change or remove anyone's article", "Cambiar o quitar el artículo de cualquiera", "Modificare o rimuovere l'articolo di chiunque"),
    summary: T("Knowledge base editors keep articles correct, whoever wrote them.", "Los editores de la base de conocimientos mantienen los artículos correctos, sin importar quién los escribió.", "Gli editor della base di conoscenza mantengono corretti gli articoli, chiunque li abbia scritti."),
    steps: [
      T("Open the article and press Edit, change it and save.", "Abra el artículo, pulse Editar, cámbielo y guarde.", "Apri l'articolo, premi Modifica, cambialo e salva."),
      T("To take it out of the list, press Remove, then Yes, remove.", "Para quitarlo de la lista, pulse Eliminar y luego Sí, eliminar.", "Per toglierlo dall'elenco premi Rimuovi, poi Sì, rimuovi."),
    ],
    tip: T("Imported documents keep their steps and tables from the source. To change those, import the document again.", "Los documentos importados mantienen sus pasos y tablas del original. Para cambiarlos, importe el documento otra vez.", "I documenti importati mantengono passaggi e tabelle dall'originale. Per cambiarli, importa di nuovo il documento."),
  },
  {
    id: "import-docs", area: "kb", needs: ["kb.view", "kb.import"],
    title: T("Import Training Center documents", "Importar documentos del Training Center", "Importare i documenti del Training Center"),
    summary: T("Bring the Ronchi documents (OPLs, how-tos, known issues) into the knowledge base from the import file.", "Traiga los documentos Ronchi (lecciones de un punto, instructivos, problemas conocidos) a la base de conocimientos desde el archivo de importación.", "Porta i documenti Ronchi (OPL, istruzioni, problemi noti) nella base di conoscenza dal file di importazione."),
    steps: [
      T("Open Knowledge base and press Import documents (JSON).", "Abra Base de conocimientos y pulse Importar documentos (JSON).", "Apri Base di conoscenza e premi Importa documenti (JSON)."),
      T("Choose the file Knowledge base documents.json.", "Elija el archivo Knowledge base documents.json.", "Scegli il file Knowledge base documents.json."),
      T("The portal tells you how many were added, updated and skipped. Importing again updates, it doesn't duplicate.", "El portal indica cuántos se agregaron, actualizaron y omitieron. Importar otra vez actualiza, no duplica.", "Il portale indica quanti sono stati aggiunti, aggiornati e saltati. Importare di nuovo aggiorna, non duplica."),
    ],
  },
  {
    id: "publish-kb", area: "kb", needs: ["kb.view", "kb.publish"],
    title: T("Publish an article to the customer help center", "Publicar un artículo en el centro de ayuda para clientes", "Pubblicare un articolo nel centro assistenza clienti"),
    summary: T("Customers can read it with no login. A scan stops anything with customer details first.", "Los clientes lo leen sin iniciar sesión. Antes, un análisis detiene cualquier dato de clientes.", "I clienti lo leggono senza accesso. Prima un controllo blocca qualsiasi dato dei clienti."),
    steps: [
      T("Open an article marked for customers and press Publish to help center.", "Abra un artículo marcado para clientes y pulse Publicar en el centro de ayuda.", "Apri un articolo destinato ai clienti e premi Pubblica nel centro assistenza."),
      T("If Customer details found appears, change the article, or tick words that aren't customer details, and publish again.", "Si aparece Se encontraron datos de clientes, cambie el artículo o marque las palabras que no son datos de clientes, y publique otra vez.", "Se compare Trovati dati di clienti, cambia l'articolo o spunta le parole che non sono dati di clienti, e pubblica di nuovo."),
      T("After a change, press Publish changes. Take off help center removes it from customers.", "Después de un cambio, pulse Publicar cambios. Quitar del centro de ayuda lo retira para los clientes.", "Dopo una modifica premi Pubblica modifiche. Togli dal centro assistenza lo ritira per i clienti."),
    ],
    tip: T("Customers must never see another customer's name, site or machine numbers. Machine numbers and passwords can never be ticked through.", "Los clientes nunca deben ver el nombre, sitio o números de máquina de otro cliente. Números de máquina y contraseñas nunca se pueden aprobar.", "I clienti non devono mai vedere nome, sito o numeri macchina di un altro cliente. Numeri macchina e password non si possono mai approvare."),
  },

  // ---------- Machines ----------
  {
    id: "find-machine", area: "machines", needs: ["machines.view"],
    title: T("Look up a machine", "Buscar una máquina", "Cercare una macchina"),
    summary: T("Each machine's page brings together its details, boards and change-part orders.", "La página de cada máquina reúne sus datos, tableros y pedidos de cambio de formato.", "La pagina di ogni macchina riunisce dati, bacheche e ordini cambio formato."),
    steps: [
      T("Open Machines and search by machine number, model, customer or site.", "Abra Máquinas y busque por número de máquina, modelo, cliente o sitio.", "Apri Macchine e cerca per numero macchina, modello, cliente o sito."),
      T("Press a machine to open its page.", "Pulse una máquina para abrir su página.", "Premi una macchina per aprire la sua pagina."),
      T("Use Open the SharePoint folder for its manuals and service reports.", "Use Abrir la carpeta de SharePoint para sus manuales e informes de servicio.", "Usa Apri la cartella SharePoint per manuali e rapporti di assistenza."),
    ],
  },
  {
    id: "add-machine", area: "machines", needs: ["machines.view", "machines.add"],
    title: T("Add a machine", "Agregar una máquina", "Aggiungere una macchina"),
    summary: T("Put a new machine on the list.", "Ponga una máquina nueva en la lista.", "Metti una nuova macchina nell'elenco."),
    steps: [
      T("Open Machines and press Add machine.", "Abra Máquinas y pulse Agregar máquina.", "Apri Macchine e premi Aggiungi macchina."),
      T("Type the machine number (like 4222TP), model, customer and site.", "Escriba el número de máquina (como 4222TP), modelo, cliente y sitio.", "Scrivi numero macchina (come 4222TP), modello, cliente e sito."),
      T("Press Save machine.", "Pulse Guardar máquina.", "Premi Salva macchina."),
    ],
  },
  {
    id: "edit-machine", area: "machines", needs: ["machines.view", "machines.edit"],
    title: T("Update a machine's details", "Actualizar los datos de una máquina", "Aggiornare i dati di una macchina"),
    summary: T("Change the model, customer, site, notes and SharePoint link.", "Cambie modelo, cliente, sitio, notas y enlace de SharePoint.", "Cambia modello, cliente, sito, note e link SharePoint."),
    steps: [
      T("Open the machine's page and press Edit.", "Abra la página de la máquina y pulse Editar.", "Apri la pagina della macchina e premi Modifica."),
      T("Change what you need. Paste the machine's folder address into SharePoint folder link.", "Cambie lo necesario. Pegue la dirección de la carpeta en Enlace de la carpeta de SharePoint.", "Cambia ciò che serve. Incolla l'indirizzo della cartella in Link della cartella SharePoint."),
      T("Press Save.", "Pulse Guardar.", "Premi Salva."),
    ],
    tip: T("Filling in the model lets the knowledge base find documents for that machine type.", "Completar el modelo permite que la base de conocimientos encuentre documentos de ese tipo de máquina.", "Compilare il modello permette alla base di conoscenza di trovare i documenti di quel tipo di macchina."),
  },

  // ---------- Parts catalog ----------
  {
    id: "browse-catalog", area: "catalog", needs: ["catalog.view"],
    title: T("Find a part in the catalog", "Encontrar una pieza en el catálogo", "Trovare un ricambio nel catalogo"),
    summary: T("Search every machine by part number or name, and see drawings, 3D and where a part is used.", "Busque en todas las máquinas por número o nombre de pieza, y vea dibujos, 3D y dónde se usa una pieza.", "Cerca in tutte le macchine per codice o nome, e vedi disegni, 3D e dove è usato un ricambio."),
    steps: [
      T("Open Parts catalog and type a part number or name in the search box.", "Abra Catálogo de piezas y escriba un número o nombre de pieza en la búsqueda.", "Apri Catalogo ricambi e scrivi un codice o nome nella ricerca."),
      T("Or open a machine to browse its drawings. Click a balloon on a drawing to find its row in the parts list.", "O abra una máquina para ver sus dibujos. Haga clic en un globo del dibujo para encontrar su fila en la lista de piezas.", "Oppure apri una macchina per sfogliare i disegni. Fai clic su un palloncino per trovare la riga nella distinta."),
      T("Press a part to see Where it's used and the Staff notes.", "Pulse una pieza para ver Dónde se usa y las Notas del personal.", "Premi un ricambio per vedere Dove è usato e le Note del personale."),
    ],
  },
  {
    id: "catalog-note", area: "catalog", needs: ["catalog.view"],
    title: T("Leave a staff note on a part", "Dejar una nota del personal en una pieza", "Lasciare una nota del personale su un ricambio"),
    summary: T("Fix tips, what to watch for, where to buy it. Only staff see these; they're never published.", "Consejos de arreglo, qué vigilar, dónde comprarla. Solo el personal las ve; nunca se publican.", "Consigli di riparazione, cosa controllare, dove comprarlo. Le vede solo il personale; non vengono mai pubblicate."),
    steps: [
      T("Find the part in Parts catalog and open it.", "Busque la pieza en Catálogo de piezas y ábrala.", "Trova il ricambio in Catalogo ricambi e aprilo."),
      T("Under Staff notes, write your note and press Add note.", "En Notas del personal, escriba su nota y pulse Añadir nota.", "In Note del personale scrivi la nota e premi Aggiungi nota."),
    ],
  },
  {
    id: "build-catalog", area: "catalog", needs: ["catalog.view", "catalog.edit"],
    title: T("Build a machine's catalog from its manual", "Crear el catálogo de una máquina desde su manual", "Creare il catalogo di una macchina dal manuale"),
    summary: T("The portal reads the parts tables in chapter 11 of the manual PDF.", "El portal lee las tablas de piezas del capítulo 11 del manual en PDF.", "Il portale legge le tabelle ricambi del capitolo 11 del manuale PDF."),
    steps: [
      T("Open Parts catalog, tick Show machines with no catalog yet, and open the machine.", "Abra Catálogo de piezas, marque Mostrar máquinas sin catálogo y abra la máquina.", "Apri Catalogo ricambi, spunta Mostra macchine ancora senza catalogo e apri la macchina."),
      T("Press Import from manual, choose the manual PDF, set the first and last page, and press Read.", "Pulse Importar del manual, elija el PDF, indique la primera y última página y pulse Leer.", "Premi Importa dal manuale, scegli il PDF, indica prima e ultima pagina e premi Leggi."),
      T("Check the drawings it found, then save them.", "Revise los dibujos encontrados y guárdelos.", "Controlla i disegni trovati, poi salvali."),
      T("Open each drawing and press Place balloons: pick a row in the parts list and click its spot on the drawing. Press Done placing when finished.", "Abra cada dibujo y pulse Colocar globos: elija una fila de la lista de piezas y haga clic en su lugar en el dibujo. Pulse Terminar de colocar al acabar.", "Apri ogni disegno e premi Posiziona palloncini: scegli una riga della distinta e fai clic sul punto del disegno. Premi Fine posizionamento alla fine."),
    ],
    tip: T("Add 3D from a STEP or GLB file on a drawing to give it a model customers can turn and take apart.", "Use Añadir 3D desde un archivo STEP o GLB en un dibujo para darle un modelo que los clientes puedan girar y desarmar.", "Usa Aggiungi 3D da un file STEP o GLB su un disegno per dargli un modello che i clienti possono ruotare e smontare."),
  },
  {
    id: "publish-catalog", area: "catalog", needs: ["catalog.view", "catalog.edit"],
    title: T("Publish a catalog to customers", "Publicar un catálogo para clientes", "Pubblicare un catalogo per i clienti"),
    summary: T("Customers who own the machine see it on the parts site right away.", "Los clientes dueños de la máquina lo ven de inmediato en el sitio de piezas.", "I clienti che possiedono la macchina lo vedono subito sul sito ricambi."),
    steps: [
      T("Open the machine in Parts catalog and press Publish to customers.", "Abra la máquina en Catálogo de piezas y pulse Publicar para clientes.", "Apri la macchina in Catalogo ricambi e premi Pubblica per i clienti."),
      T("Confirm. Wait while the drawings and 3D models copy across.", "Confirme. Espere mientras se copian los dibujos y modelos 3D.", "Conferma. Attendi che disegni e modelli 3D vengano copiati."),
      T("Press Unpublish to take it off the parts site.", "Pulse Retirar para quitarlo del sitio de piezas.", "Premi Ritira per toglierlo dal sito ricambi."),
    ],
    tip: T("Staff notes never go to the parts site.", "Las notas del personal nunca van al sitio de piezas.", "Le note del personale non vanno mai sul sito ricambi."),
  },

  // ---------- Customers and quotes ----------
  {
    id: "customer-companies", area: "customers", needs: ["customers.manage"],
    title: T("Set up a customer company", "Dar de alta una empresa cliente", "Configurare un'azienda cliente"),
    summary: T("A company sees only the machines you give it on the parts site.", "Una empresa ve en el sitio de piezas solo las máquinas que usted le asigna.", "Un'azienda vede sul sito ricambi solo le macchine che le assegni."),
    steps: [
      T("Open Customers, type the company name as the customer knows it, and press Add company.", "Abra Clientes, escriba el nombre de la empresa como el cliente lo conoce y pulse Añadir empresa.", "Apri Clienti, scrivi il nome dell'azienda come lo conosce il cliente e premi Aggiungi azienda."),
      T("Press Manage, type its machine numbers under Machines they see, and press Save machines.", "Pulse Gestionar, escriba sus números de máquina en Máquinas que ven y pulse Guardar máquinas.", "Premi Gestisci, scrivi i numeri macchina in Macchine che vedono e premi Salva macchine."),
      T("Turn company off signs everyone at that company out until you turn it back on.", "Desactivar empresa cierra la sesión de todos en esa empresa hasta que la vuelva a activar.", "Disattiva azienda disconnette tutti in quell'azienda finché non la riattivi."),
    ],
  },
  {
    id: "customer-logins", area: "customers", needs: ["customers.manage", "customers.invite"],
    title: T("Give a customer a login", "Dar acceso a un cliente", "Dare un accesso a un cliente"),
    summary: T("Customers sign in to the parts site with a passkey, from a sign-up link you send.", "Los clientes entran al sitio de piezas con una llave de acceso, desde un enlace de registro que usted envía.", "I clienti accedono al sito ricambi con una passkey, da un link di registrazione che mandi tu."),
    steps: [
      T("Open Customers, press Manage on the company, and fill in the person's name and email.", "Abra Clientes, pulse Gestionar en la empresa y complete el nombre y correo de la persona.", "Apri Clienti, premi Gestisci sull'azienda e compila nome ed email della persona."),
      T("Tick Can send quote requests if they're a buyer, then press Make sign-up link.", "Marque Puede enviar solicitudes de cotización si es comprador y pulse Crear enlace de registro.", "Spunta Può inviare richieste di offerta se è un acquirente, poi premi Crea link di registrazione."),
      T("Copy the link and send it only to that person. It works once, for 7 days.", "Copie el enlace y envíelo solo a esa persona. Funciona una vez, durante 7 días.", "Copia il link e mandalo solo a quella persona. Funziona una volta, per 7 giorni."),
      T("Use Turn off or Turn on next to a person to stop or allow their sign-in. New sign-in link helps someone on a new device; Cancel link stops an unused one.", "Use Desactivar o Activar junto a una persona para bloquear o permitir su acceso. Nuevo enlace de acceso ayuda a quien tiene un dispositivo nuevo; Cancelar enlace anula uno sin usar.", "Usa Disattiva o Attiva accanto a una persona per bloccare o consentire l'accesso. Nuovo link di accesso aiuta chi ha un dispositivo nuovo; Annulla link blocca un link non usato."),
    ],
  },
  {
    id: "quote-requests", area: "customers", needs: ["quotes.manage"], open: "/quotes",
    title: T("Handle quote requests", "Atender solicitudes de cotización", "Gestire le richieste di offerta"),
    summary: T("Parts lists customers send from the parts site.", "Listas de piezas que los clientes envían desde el sitio de piezas.", "Distinte che i clienti inviano dal sito ricambi."),
    steps: [
      T("Press Open the page below, or Quote requests on the Customers page. Use the list at the top right to show one status only.", "Pulse Abrir la página aquí abajo, o Solicitudes de cotización en la página Clientes. Use la lista de arriba a la derecha para ver un solo estado.", "Premi Apri la pagina qui sotto, o Richieste di offerta nella pagina Clienti. Usa l'elenco in alto a destra per vedere un solo stato."),
      T("Press a request number to see the parts, quantities and notes.", "Pulse el número de una solicitud para ver piezas, cantidades y notas.", "Premi il numero di una richiesta per vedere ricambi, quantità e note."),
      T("Change its Status as you work on it. Reply to the customer at the email shown.", "Cambie su Estado mientras la atiende. Responda al cliente al correo indicado.", "Cambia lo Stato mentre la gestisci. Rispondi al cliente all'email indicata."),
    ],
  },

  // ---------- Change-part orders ----------
  {
    id: "view-orders", area: "change-parts", needs: ["orders.view"],
    title: T("Follow change-part orders", "Seguir los pedidos de cambio de formato", "Seguire gli ordini cambio formato"),
    summary: T("See every job, from quote to shipped. No dollar amounts are kept here.", "Vea cada trabajo, de la cotización al envío. Aquí no se guardan importes.", "Vedi ogni lavoro, dall'offerta alla spedizione. Qui non si tengono importi."),
    steps: [
      T("Open Change parts. The counts at the top show open jobs, ones shipping soon and ones past their ship date.", "Abra Cambio de formato. Los totales de arriba muestran trabajos abiertos, próximos a enviar y atrasados.", "Apri Cambio formato. I conteggi in alto mostrano lavori aperti, in spedizione a breve e in ritardo."),
      T("Search by customer, machine, part, PO or notes, and filter by status.", "Busque por cliente, máquina, pieza, orden de compra o notas, y filtre por estado.", "Cerca per cliente, macchina, ricambio, ordine d'acquisto o note, e filtra per stato."),
      T("Open an order to see its details and its History. Export CSV gives you a spreadsheet.", "Abra un pedido para ver sus datos y su Historial. Exportar CSV le da una hoja de cálculo.", "Apri un ordine per vederne i dati e la Cronologia. Esporta CSV ti dà un foglio di calcolo."),
    ],
  },
  {
    id: "add-order", area: "change-parts", needs: ["orders.view", "orders.add"],
    title: T("Add a change-part order", "Agregar un pedido de cambio de formato", "Aggiungere un ordine cambio formato"),
    summary: T("Start tracking a new job.", "Empiece a seguir un trabajo nuevo.", "Inizia a seguire un nuovo lavoro."),
    steps: [
      T("Open Change parts and press New order.", "Abra Cambio de formato y pulse Nuevo pedido.", "Apri Cambio formato e premi Nuovo ordine."),
      T("Fill in the customer, machine, part and status, plus any POs, samples and ship date you have.", "Complete cliente, máquina, pieza y estado, y las órdenes de compra, muestras y fecha de envío que tenga.", "Compila cliente, macchina, ricambio e stato, più ordini d'acquisto, campioni e data di spedizione se li hai."),
      T("Press Add order.", "Pulse Agregar pedido.", "Premi Aggiungi ordine."),
    ],
  },
  {
    id: "edit-order", area: "change-parts", needs: ["orders.view", "orders.edit"],
    title: T("Update an order's status", "Actualizar el estado de un pedido", "Aggiornare lo stato di un ordine"),
    summary: T("Keep the job current as samples arrive and parts ship.", "Mantenga el trabajo al día a medida que llegan muestras y se envían piezas.", "Tieni aggiornato il lavoro quando arrivano i campioni e partono i ricambi."),
    steps: [
      T("Open the order and press Edit.", "Abra el pedido y pulse Editar.", "Apri l'ordine e premi Modifica."),
      T("Change the status, dates or notes and press Save.", "Cambie estado, fechas o notas y pulse Guardar.", "Cambia stato, date o note e premi Salva."),
    ],
    tip: T("If someone else saved the order while you were editing, the portal stops you so nothing is overwritten. Reload and try again.", "Si otra persona guardó el pedido mientras usted editaba, el portal lo detiene para no sobrescribir nada. Recargue e intente otra vez.", "Se qualcun altro ha salvato l'ordine mentre lo modificavi, il portale ti ferma per non sovrascrivere nulla. Ricarica e riprova."),
  },
  {
    id: "remove-order", area: "change-parts", needs: ["orders.view", "orders.remove"],
    title: T("Remove an order", "Quitar un pedido", "Rimuovere un ordine"),
    summary: T("Take an order off the list. It stays in the record.", "Quite un pedido de la lista. Queda en el registro.", "Togli un ordine dall'elenco. Resta nell'archivio."),
    steps: [
      T("Open the order and press Remove.", "Abra el pedido y pulse Eliminar.", "Apri l'ordine e premi Rimuovi."),
      T("Press Yes, remove to confirm.", "Pulse Sí, eliminar para confirmar.", "Premi Sì, rimuovi per confermare."),
    ],
  },
  {
    id: "import-orders", area: "change-parts", needs: ["orders.view", "orders.import"],
    title: T("Import orders from the master sheet", "Importar pedidos desde la hoja maestra", "Importare ordini dal foglio principale"),
    summary: T("Bring in jobs from the Change Parts Management Master Sheet or another CSV.", "Traiga trabajos desde la Change Parts Management Master Sheet u otro CSV.", "Importa lavori dal Change Parts Management Master Sheet o da un altro CSV."),
    steps: [
      T("In Excel, open the sheet and use File, Save As, CSV.", "En Excel, abra la hoja y use Archivo, Guardar como, CSV.", "In Excel apri il foglio e usa File, Salva con nome, CSV."),
      T("In Change parts press Import CSV and choose the file.", "En Cambio de formato pulse Importar CSV y elija el archivo.", "In Cambio formato premi Importa CSV e scegli il file."),
      T("Check what was found. Orders already here are skipped. Press Add to bring in the rest.", "Revise lo encontrado. Los pedidos que ya existen se omiten. Pulse Agregar para traer el resto.", "Controlla cosa è stato trovato. Gli ordini già presenti vengono saltati. Premi Aggiungi per importare il resto."),
    ],
  },

  // ---------- People and access (admins) ----------
  {
    id: "invite-employee", area: "people", needs: ["users.manage"],
    title: T("Add an employee", "Agregar un empleado", "Aggiungere un dipendente"),
    summary: T("Make an invite link so a new person can create their login.", "Cree un enlace de invitación para que una persona nueva cree su acceso.", "Crea un link di invito perché una persona nuova crei il suo accesso."),
    steps: [
      T("Open People, then Employees, and find Add an employee.", "Abra Personas, luego Empleados, y busque Agregar un empleado.", "Apri Persone, poi Dipendenti, e cerca Aggiungi un dipendente."),
      T("Type their full name, work email or a username, and pick their role.", "Escriba su nombre completo, correo de trabajo o un nombre de usuario, y elija su rol.", "Scrivi nome completo, email di lavoro o un nome utente, e scegli il ruolo."),
      T("Press Create invite link and send it to them directly, by Teams or text. It's shown once and works for 3 days.", "Pulse Crear enlace de invitación y envíeselo directamente, por Teams o mensaje. Se muestra una vez y funciona 3 días.", "Premi Crea link di invito e mandalo direttamente, via Teams o messaggio. Si vede una volta e funziona 3 giorni."),
    ],
  },
  {
    id: "roles", area: "people", needs: ["users.manage"],
    title: T("Make and change roles", "Crear y cambiar roles", "Creare e modificare ruoli"),
    summary: T("A role is a set of switches. Everyone with the role gets the change on their next click.", "Un rol es un conjunto de interruptores. Todos los que tienen el rol reciben el cambio en su siguiente clic.", "Un ruolo è un insieme di interruttori. Tutti quelli con quel ruolo ricevono la modifica al clic successivo."),
    steps: [
      T("Open People, then Roles.", "Abra Personas, luego Roles.", "Apri Persone, poi Ruoli."),
      T("To make one, type a role name under Make a role, pick a role to start from, and press Make role.", "Para crear uno, escriba un nombre en Crear un rol, elija un rol de partida y pulse Crear rol.", "Per crearne uno, scrivi un nome in Crea un ruolo, scegli un ruolo di partenza e premi Crea ruolo."),
      T("Press Edit on a role, switch things on or off, and press Save role. Admin always has everything and can't be changed.", "Pulse Editar en un rol, active o desactive lo que quiera y pulse Guardar rol. Admin siempre lo tiene todo y no se puede cambiar.", "Premi Modifica su un ruolo, attiva o disattiva ciò che vuoi e premi Salva ruolo. Admin ha sempre tutto e non si può cambiare."),
      T("Back to original undoes changes to a built-in role.", "Volver al original deshace los cambios de un rol incorporado.", "Torna all'originale annulla le modifiche a un ruolo predefinito."),
    ],
    tip: T("This training follows the switches, so new roles get the right guides automatically.", "Esta capacitación sigue los interruptores, así que los roles nuevos reciben las guías correctas automáticamente.", "Questa formazione segue gli interruttori, quindi i nuovi ruoli ricevono automaticamente le guide giuste."),
  },
  {
    id: "person-access", area: "people", needs: ["users.manage"],
    title: T("Change what one person can do", "Cambiar lo que puede hacer una persona", "Cambiare cosa può fare una persona"),
    summary: T("Switch single permissions on or off for one person, on top of their role.", "Active o desactive permisos sueltos para una persona, además de su rol.", "Attiva o disattiva singoli permessi per una persona, oltre al suo ruolo."),
    steps: [
      T("Open People, then Employees, and press Access next to the person.", "Abra Personas, luego Empleados, y pulse Acceso junto a la persona.", "Apri Persone, poi Dipendenti, e premi Accesso accanto alla persona."),
      T("Switch anything on or off. View only keeps just the seeing switches on.", "Active o desactive lo que quiera. Solo ver deja activos solo los permisos para ver.", "Attiva o disattiva ciò che vuoi. Solo visualizzazione lascia attivi solo i permessi per vedere."),
      T("Back to the role removes their personal changes.", "Volver al rol quita sus cambios personales.", "Torna al ruolo rimuove le modifiche personali."),
    ],
    tip: T("To change their role instead, pick it in the Role column.", "Para cambiar su rol, elíjalo en la columna Rol.", "Per cambiare il ruolo, sceglilo nella colonna Ruolo."),
  },
  {
    id: "disable-remove", area: "people", needs: ["users.manage"],
    title: T("Disable, remove or sign someone out", "Desactivar, quitar o cerrar la sesión de alguien", "Disattivare, rimuovere o disconnettere qualcuno"),
    summary: T("Stop someone signing in, for now or for good.", "Impida que alguien inicie sesión, por ahora o para siempre.", "Impedisci a qualcuno di accedere, per ora o per sempre."),
    steps: [
      T("Sign out everywhere ends all their sessions, for a lost phone.", "Cerrar sesión en todas partes termina todas sus sesiones, para un teléfono perdido.", "Disconnetti ovunque chiude tutte le sessioni, per un telefono perso."),
      T("Disable blocks sign-in for now; Re-enable lets them back in.", "Desactivar bloquea el acceso por ahora; Reactivar lo devuelve.", "Disattiva blocca l'accesso per ora; Riattiva lo ripristina."),
      T("Remove takes someone off the list for good. Their history, orders and messages stay. Restore them from Removed employees.", "Eliminar quita a alguien de la lista para siempre. Su historial, pedidos y mensajes quedan. Restáurelo desde Empleados quitados.", "Rimuovi toglie qualcuno dall'elenco per sempre. Cronologia, ordini e messaggi restano. Ripristinalo da Dipendenti rimossi."),
    ],
  },
  {
    id: "quick-links", area: "people", needs: ["users.manage"], open: "/",
    title: T("Set up quick links on Home", "Configurar los enlaces rápidos en Inicio", "Impostare i link rapidi nella Home"),
    summary: T("Buttons on Home that open websites, for everyone or for chosen roles and people.", "Botones en Inicio que abren sitios web, para todos o para roles y personas elegidos.", "Pulsanti nella Home che aprono siti web, per tutti o per ruoli e persone scelti."),
    steps: [
      T("On Home, press Edit quick links.", "En Inicio, pulse Editar enlaces rápidos.", "Nella Home premi Modifica link rapidi."),
      T("Type a button name and web address, choose Who sees it, and press Add link.", "Escriba el nombre del botón y la dirección web, elija Quién lo ve y pulse Agregar enlace.", "Scrivi il nome del pulsante e l'indirizzo web, scegli Chi lo vede e premi Aggiungi link."),
      T("Use Move up, Move down, Edit and Remove to tidy them, then press Done.", "Use Subir, Bajar, Editar y Eliminar para ordenarlos y pulse Listo.", "Usa Sposta su, Sposta giù, Modifica e Rimuovi per sistemarli, poi premi Fatto."),
    ],
  },
  {
    id: "workbook-switch", area: "people", needs: ["users.manage"], open: "/settings",
    title: T("Switch the Ronchi workbook on or off", "Encender o apagar el cuaderno de trabajo Ronchi", "Accendere o spegnere il quaderno di lavoro Ronchi"),
    summary: T("If the team keeps its Excel sheets, hide Work orders for everyone.", "Si el equipo sigue con sus hojas de Excel, oculte Órdenes de trabajo para todos.", "Se il team continua con i fogli Excel, nascondi Ordini di lavoro a tutti."),
    steps: [
      T("Open Settings and find Ronchi workbook.", "Abra Configuración y busque Cuaderno de trabajo Ronchi.", "Apri Impostazioni e cerca Quaderno di lavoro Ronchi."),
      T("Untick it and confirm. Jobs, job emails and job files keep working, and nothing is deleted.", "Desmárquelo y confirme. Los trabajos, sus correos y archivos siguen funcionando y no se borra nada.", "Togli la spunta e conferma. Lavori, email e file dei lavori continuano a funzionare e non si cancella nulla."),
    ],
  },
  {
    id: "admin-controls", area: "people", needs: ["settings.manage"], open: "/settings",
    title: T("Use the admin controls", "Usar los controles de administrador", "Usare i controlli amministratore"),
    summary: T("Portal-wide settings: usage, a notice for everyone, sign-in, sections, chat limits, languages, looks and emergency sign-out.", "Ajustes de todo el portal: uso, un aviso para todos, inicio de sesión, secciones, límites de chat, idiomas, aspectos y cierre de sesión de emergencia.", "Impostazioni di tutto il portale: utilizzo, un avviso per tutti, accesso, sezioni, limiti delle chat, lingue, aspetti e disconnessione di emergenza."),
    steps: [
      T("Open Settings and press Admin controls.", "Abra Configuración y pulse Controles de administrador.", "Apri Impostazioni e premi Controlli amministratore."),
      T("Change what you need. A bar appears at the bottom; press Save changes, or Discard to undo.", "Cambie lo que necesite. Aparece una barra abajo; pulse Guardar cambios, o Descartar para deshacer.", "Modifica ciò che ti serve. In basso compare una barra; premi Salva modifiche, oppure Scarta per annullare."),
      T("Reset this group puts one group back to how the portal started. Roles and one person's access are changed on People.", "Restablecer este grupo devuelve un grupo a como empezó el portal. Los roles y el acceso de una persona se cambian en Personas.", "Ripristina questo gruppo riporta un gruppo come all'inizio. Ruoli e accesso di una persona si cambiano in Persone."),
    ],
    tip: T("Turning a section off hides it from everyone except admins, even someone given it personally.", "Apagar una sección la oculta a todos excepto a los administradores, incluso a quien la tenga de forma personal.", "Spegnere una sezione la nasconde a tutti tranne agli amministratori, anche a chi l'ha avuta personalmente."),
  },
  {
    id: "audit-log", area: "people", needs: ["users.manage", "audit.view"],
    title: T("Check the audit log", "Revisar el registro de auditoría", "Controllare il registro di controllo"),
    summary: T("See who did what, and when.", "Vea quién hizo qué y cuándo.", "Vedi chi ha fatto cosa e quando."),
    steps: [
      T("Open People and scroll to Recent activity (audit log).", "Abra Personas y baje hasta Actividad reciente (registro de auditoría).", "Apri Persone e scorri fino ad Attività recente (registro di controllo)."),
      T("Each line shows when, who, what and from where.", "Cada línea muestra cuándo, quién, qué y desde dónde.", "Ogni riga mostra quando, chi, cosa e da dove."),
    ],
  },
];

/** The guides a person can follow with these permissions. */
export function guidesFor(perms: readonly string[]): Guide[] {
  const have = new Set(perms);
  return GUIDES.filter((g) => g.needs.every((p) => have.has(p)));
}

/** Which of these roles can follow a guide, from each role's real switches. */
export function rolesThatCan<R extends { perms: readonly string[] }>(guide: Guide, roles: R[]): R[] {
  return roles.filter((r) => guide.needs.every((p) => r.perms.includes(p)));
}

/** Guide text in one language. */
export function inLang(text: Text, lang: keyof Text): string {
  return text[lang] || text.en;
}
