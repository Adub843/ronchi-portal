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
    id: "jobs", paths: ["/jobs"],
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
    title: T("Change parts", "Cambio de formato", "Cambio formato"),
    blurb: T("Every change-part job, from the first request to shipped: the sale, then the order.", "Cada trabajo de cambio de formato, de la primera solicitud al envío: la venta y luego el pedido.", "Ogni lavoro di cambio formato, dalla prima richiesta alla spedizione: la vendita, poi l'ordine."),
  },
  {
    id: "machine-sales", paths: ["/machine-sales"],
    title: T("Machine sales", "Ventas de máquinas", "Vendite macchine"),
    blurb: T("New-machine deals, from the first call to a machine running on the customer's line.", "Negocios de máquinas nuevas, desde la primera llamada hasta la máquina funcionando en la línea del cliente.", "Trattative per macchine nuove, dalla prima chiamata alla macchina in funzione sulla linea del cliente."),
  },
  {
    id: "parts-orders", paths: ["/parts-orders"],
    title: T("Parts orders", "Pedidos de repuestos", "Ordini ricambi"),
    blurb: T("Spare parts sales, from the customer's first ask to the invoice.", "Ventas de repuestos, desde la primera consulta del cliente hasta la factura.", "Vendite di ricambi, dalla prima richiesta del cliente alla fattura."),
  },
  {
    id: "people", paths: ["/people"],
    title: T("People and access", "Personas y acceso", "Persone e accessi"),
    blurb: T("Adding employees, making roles and deciding what each person can do. Admins only.", "Agregar empleados, crear roles y decidir qué puede hacer cada persona. Solo administradores.", "Aggiungere dipendenti, creare ruoli e decidere cosa può fare ogni persona. Solo amministratori."),
  },
  {
    id: "shipping", paths: ["/shipping"],
    title: T("Shipping and receiving", "Envíos y recepción", "Spedizioni e ricevimento"),
    blurb: T("Machines, spare parts and change parts going out, and parts from Italy, suppliers and customers coming in.", "Máquinas, repuestos y cambios de formato que salen, y piezas de Italia, proveedores y clientes que entran.", "Macchine, ricambi e cambi formato in uscita, e parti dall'Italia, dai fornitori e dai clienti in entrata."),
  },
  {
    id: "inventory", paths: ["/inventory"],
    title: T("Inventory", "Inventario", "Inventario"),
    blurb: T("What is on the shelves, where it is, what is held for orders and what is running low.", "Qué hay en los estantes, dónde está, qué está apartado para pedidos y qué se está acabando.", "Cosa c'è sugli scaffali, dove si trova, cosa è impegnato per gli ordini e cosa sta finendo."),
  },
];

export const GUIDES: Guide[] = [
  // ---------- Getting started (everyone) ----------
  {
    id: "sign-in", area: "basics", needs: [],
    title: T("Sign in for the first time", "Iniciar sesión por primera vez", "Accedere la prima volta"),
    summary: T("You sign in with a username and a password. The first time, you choose the password yourself.", "Se entra con un nombre de usuario y una contraseña. La primera vez, usted mismo elige la contraseña.", "Si accede con un nome utente e una password. La prima volta scegli tu la password."),
    steps: [
      T("Open the portal and type the username an admin gave you. Leave the password empty and press Sign in.", "Abra el portal y escriba el nombre de usuario que le dio un administrador. Deje la contraseña vacía y pulse Iniciar sesión.", "Apri il portale e scrivi il nome utente che ti ha dato un amministratore. Lascia vuota la password e premi Accedi."),
      T("Type a new password of at least 8 characters, twice, and press Save password and sign in.", "Escriba una contraseña nueva de al menos 8 caracteres, dos veces, y pulse Guardar contraseña e iniciar sesión.", "Scrivi una nuova password di almeno 8 caratteri, due volte, e premi Salva la password e accedi."),
      T("Next time, type your username and that password.", "La próxima vez, escriba su nombre de usuario y esa contraseña.", "La prossima volta scrivi il nome utente e quella password."),
    ],
    tip: T("Forgot your password, or your first sign-in ran out? Ask an admin to press Reset password.", "¿Olvidó su contraseña o venció su primer inicio de sesión? Pida a un administrador que pulse Restablecer contraseña.", "Hai dimenticato la password o il primo accesso è scaduto? Chiedi a un amministratore di premere Reimposta password."),
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
    title: T("Change your password", "Cambiar su contraseña", "Cambiare la password"),
    summary: T("You can change your password any time. The same username and password work on your phone and every computer.", "Puede cambiar su contraseña cuando quiera. El mismo nombre de usuario y contraseña sirven en su teléfono y en cualquier computadora.", "Puoi cambiare la password quando vuoi. Lo stesso nome utente e la stessa password valgono sul telefono e su ogni computer."),
    steps: [
      T("Open Settings and find Your devices.", "Abra Configuración y busque Sus dispositivos.", "Apri Impostazioni e cerca I tuoi dispositivi."),
      T("Press Change password. Type your current password, then the new one twice.", "Pulse Cambiar contraseña. Escriba su contraseña actual y luego la nueva dos veces.", "Premi Cambia password. Scrivi la password attuale, poi quella nuova due volte."),
      T("Press Save password. Your other devices are signed out and need the new password.", "Pulse Guardar contraseña. Sus otros dispositivos cierran sesión y necesitan la contraseña nueva.", "Premi Salva password. Gli altri dispositivi vengono disconnessi e servirà la nuova password."),
    ],
  },
  {
    id: "install-app", area: "basics", needs: [],
    title: T("Put the portal on your phone or desktop as an app", "Poner el portal como aplicación en su teléfono o escritorio", "Mettere il portale come app sul telefono o sul desktop"),
    summary: T("The portal can open in its own window with a Ronchi icon, like any other app. Nothing to download from a store.", "El portal puede abrirse en su propia ventana con un icono de Ronchi, como cualquier aplicación. No hay que descargar nada de una tienda.", "Il portale può aprirsi in una sua finestra con l'icona Ronchi, come qualsiasi app. Niente da scaricare da uno store."),
    steps: [
      T("On a computer or Android phone (Chrome or Edge): open the account menu at the top right and press Install as an app.", "En computadora o teléfono Android (Chrome o Edge): abra el menú de la cuenta arriba a la derecha y pulse Instalar como aplicación.", "Su computer o telefono Android (Chrome o Edge): apri il menu dell'account in alto a destra e premi Installa come app."),
      T("On an iPhone (Safari): press Share, then Add to Home Screen.", "En iPhone (Safari): pulse Compartir y luego Agregar a pantalla de inicio.", "Su iPhone (Safari): premi Condividi, poi Aggiungi alla schermata Home."),
      T("Open the portal from the new icon. You stay signed in, and it always shows the latest version.", "Abra el portal desde el icono nuevo. Su sesión sigue iniciada y siempre muestra la versión más reciente.", "Apri il portale dalla nuova icona. Resti collegato e mostra sempre la versione più recente."),
    ],
    tip: T("No Install as an app in the menu? It's already installed, or this browser doesn't offer it. Use the browser's own menu instead.", "¿No aparece Instalar como aplicación en el menú? Ya está instalada o este navegador no lo ofrece. Use el menú del propio navegador.", "Non vedi Installa come app nel menu? È già installata o questo browser non lo offre. Usa il menu del browser."),
  },
  {
    id: "lost-device", area: "basics", needs: [], open: "/settings",
    title: T("Sign out a lost phone", "Cerrar la sesión de un teléfono perdido", "Disconnettere un telefono perso"),
    summary: T("If a phone or computer is lost or replaced, take its sign-in away.", "Si pierde o cambia un teléfono o computadora, quítele el acceso.", "Se un telefono o computer è perso o sostituito, togli il suo accesso."),
    steps: [
      T("Open Settings and find Your devices.", "Abra Configuración y busque Sus dispositivos.", "Apri Impostazioni e cerca I tuoi dispositivi."),
      T("Press Sign out next to the device you lost.", "Pulse Cerrar sesión junto al dispositivo perdido.", "Premi Esci accanto al dispositivo perso."),
    ],
    tip: T("Think someone knows your password? Change it here, or ask an admin to press Reset password.", "¿Cree que alguien conoce su contraseña? Cámbiela aquí, o pida a un administrador que pulse Restablecer contraseña.", "Pensi che qualcuno conosca la tua password? Cambiala qui, o chiedi a un amministratore di premere Reimposta password."),
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

  {
    id: "export-chat", area: "chats", needs: ["boards.use", "boards.export"],
    title: T("Save a copy of a chat", "Guardar una copia de un chat", "Salvare una copia di una chat"),
    summary: T("Download a whole conversation as a text file.", "Descargue una conversación completa como archivo de texto.", "Scarica un'intera conversazione come file di testo."),
    steps: [
      T("Open the chat, or a board you started, and open its menu.", "Abra el chat, o un tablero que usted inició, y abra su menú.", "Apri la chat, o una bacheca che hai creato, e apri il suo menu."),
      T("Press Export chat (.txt). The file names who wrote what, and when.", "Pulse Exportar chat (.txt). El archivo indica quién escribió qué y cuándo.", "Premi Esporta chat (.txt). Il file indica chi ha scritto cosa e quando."),
    ],
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
    id: "work-orders", area: "jobs", needs: ["jobs.view"], open: "/jobs",
    title: T("Use work orders and the machine's log", "Usar las órdenes de trabajo y el historial de la máquina", "Usare gli ordini di lavoro e lo storico della macchina"),
    summary: T("The Ronchi workbook: the current work order plus every past work order for the same machine.", "El cuaderno de trabajo Ronchi: la orden de trabajo actual y todas las anteriores de la misma máquina.", "Il quaderno di lavoro Ronchi: l'ordine di lavoro attuale e tutti quelli passati della stessa macchina."),
    steps: [
      T("Open Jobs, open the job and press its Work order tab.", "Abra Trabajos, abra el trabajo y pulse su pestaña Orden de trabajo.", "Apri Lavori, apri il lavoro e premi la sua scheda Ordine di lavoro."),
      T("Read the past work orders, quick notes and change-part orders for that machine before you go.", "Lea las órdenes anteriores, notas rápidas y pedidos de cambio de formato de esa máquina antes de ir.", "Leggi gli ordini passati, le note rapide e gli ordini cambio formato di quella macchina prima di partire."),
      T("Use Print or save as PDF, or Download the log (CSV).", "Use Imprimir o guardar como PDF, o Descargar el registro (CSV).", "Usa Stampa o salva in PDF, o Scarica il registro (CSV)."),
    ],
    tip: T("If an admin switches the Ronchi workbook off, the Work order tab is gone but jobs keep working.", "Si un administrador apaga el cuaderno de trabajo Ronchi, la pestaña Orden de trabajo desaparece pero los trabajos siguen funcionando.", "Se un amministratore spegne il quaderno di lavoro Ronchi, la scheda Ordine di lavoro sparisce ma i lavori continuano a funzionare."),
  },
  {
    id: "fill-work-order", area: "jobs", needs: ["jobs.view"], open: "/jobs",
    title: T("Fill in the service report on a work order", "Llenar el informe de servicio en una orden de trabajo", "Compilare il rapporto di assistenza in un ordine di lavoro"),
    summary: T("The Ronchi workbook lives in each work order: daily log, photos, billable hours, expenses and the customer's signature. It saves as you go.", "El cuaderno de trabajo Ronchi vive en cada orden de trabajo: registro diario, fotos, horas facturables, gastos y la firma del cliente. Se guarda mientras escribe.", "Il quaderno di lavoro Ronchi è in ogni ordine di lavoro: registro giornaliero, foto, ore fatturabili, spese e firma del cliente. Si salva mentre scrivi."),
    steps: [
      T("Open your job and press its Work order tab. Pick the type of work and add each day to the Daily work log, with any issues found (one per line).", "Abra su trabajo y pulse la pestaña Orden de trabajo. Elija el tipo de trabajo y agregue cada día al Registro diario, con los problemas encontrados (uno por línea).", "Apri il tuo lavoro e premi la scheda Ordine di lavoro. Scegli il tipo di lavoro e aggiungi ogni giorno al Registro giornaliero, con i problemi trovati (uno per riga)."),
      T("Add photos of the machine and the recipe screens, with a caption.", "Agregue fotos de la máquina y de las pantallas de receta, con una leyenda.", "Aggiungi foto della macchina e delle schermate delle ricette, con una didascalia."),
      T("Enter each day's billable hours (what the customer is billed for, not a time clock) and your expenses with a receipt photo.", "Anote las horas facturables de cada día (lo que se le factura al cliente, no un reloj de fichaje) y sus gastos con foto del recibo.", "Inserisci le ore fatturabili di ogni giorno (ciò che si fattura al cliente, non una timbratura) e le spese con la foto della ricevuta."),
      T("Have the customer sign on the screen, then press Submit. The office gets the report and each issue becomes a quick note on the machine.", "Pida al cliente que firme en la pantalla y pulse Enviar. La oficina recibe el informe y cada problema se convierte en una nota rápida de la máquina.", "Fai firmare il cliente sullo schermo, poi premi Invia. L'ufficio riceve il rapporto e ogni problema diventa una nota rapida sulla macchina."),
    ],
    tip: T("Use Open the job chat to talk with everyone on the job. After Submit the report locks; a scheduler can reopen it.", "Use Abrir el chat del trabajo para hablar con todos los del trabajo. Después de Enviar el informe se bloquea; un programador puede reabrirlo.", "Usa Apri la chat del lavoro per parlare con tutti quelli del lavoro. Dopo Invia il rapporto si blocca; un pianificatore può riaprirlo."),
  },
  {
    id: "billing-week", area: "jobs", needs: ["jobs.view", "workbook.billing"], open: "/jobs",
    title: T("Bill customers from work orders", "Facturar a los clientes desde las órdenes de trabajo", "Fatturare ai clienti dagli ordini di lavoro"),
    summary: T("Every field service engineer's billable hours and expenses, one week at a time.", "Las horas facturables y los gastos de cada ingeniero de servicio de campo, semana por semana.", "Ore fatturabili e spese di ogni ingegnere di assistenza sul campo, una settimana alla volta."),
    steps: [
      T("Open Jobs and press Billing from work orders.", "Abra Trabajos y pulse Facturación desde las órdenes de trabajo.", "Apri Lavori e premi Fatturazione dagli ordini di lavoro."),
      T("Move between weeks, open a job to see its report, and press Download (CSV) for your invoicing.", "Cambie de semana, abra un trabajo para ver su informe y pulse Descargar (CSV) para facturar.", "Spostati tra le settimane, apri un lavoro per vedere il rapporto e premi Scarica (CSV) per la fatturazione."),
    ],
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
    id: "download-software", area: "kb", needs: ["kb.view", "software.view"],
    title: T("Download software for a new laptop", "Descargar software para una laptop nueva", "Scaricare il software per un portatile nuovo"),
    summary: T("Get the installers and program folders you need in one go, instead of hunting on vendor websites.", "Obtenga de una vez los instaladores y carpetas de programas que necesita, sin buscarlos en sitios de proveedores.", "Prendi in una volta sola gli installer e le cartelle dei programmi che ti servono, senza cercarli sui siti dei fornitori."),
    steps: [
      T("Open Knowledge base. Under Software and setup files, press a package such as New laptop setup.", "Abra Base de conocimientos. En Software y archivos de instalación, pulse un paquete como New laptop setup.", "Apri Base di conoscenza. In Software e file di installazione, premi un pacchetto come New laptop setup."),
      T("Tick the folders or files you want. Show files lets you pick single files inside a folder.", "Marque las carpetas o archivos que quiere. Mostrar archivos le deja elegir archivos sueltos dentro de una carpeta.", "Spunta le cartelle o i file che vuoi. Mostra file ti fa scegliere singoli file dentro una cartella."),
      T("Press Download. On Chrome or Edge, choose a folder on your computer and everything is saved there with its folders. Otherwise each file goes to Downloads.", "Pulse Descargar. En Chrome o Edge, elija una carpeta de su computadora y todo se guarda ahí con sus carpetas. Si no, cada archivo va a Descargas.", "Premi Scarica. Su Chrome o Edge scegli una cartella del computer e tutto viene salvato lì con le sue cartelle. Altrimenti ogni file va in Download."),
    ],
    tip: T("Vendor software is licensed. Keep it on company computers and don't pass the files to customers.", "El software de proveedores tiene licencia. Manténgalo en computadoras de la empresa y no pase los archivos a clientes.", "Il software dei fornitori è sotto licenza. Tienilo sui computer aziendali e non passare i file ai clienti."),
  },
  {
    id: "manage-software", area: "kb", needs: ["kb.view", "software.manage"],
    title: T("Upload software and setup files", "Subir software y archivos de instalación", "Caricare software e file di installazione"),
    summary: T("Make packages like New laptop setup and fill them with installers or whole program folders.", "Cree paquetes como New laptop setup y llénelos con instaladores o carpetas completas de programas.", "Crea pacchetti come New laptop setup e riempili con installer o intere cartelle di programmi."),
    steps: [
      T("Open Knowledge base and press Manage software.", "Abra Base de conocimientos y pulse Administrar software.", "Apri Base di conoscenza e premi Gestisci software."),
      T("Make a package, or pick one on the left. Tick Legacy software for programs that only older machines need.", "Cree un paquete o elija uno a la izquierda. Marque Software heredado para programas que solo necesitan las máquinas antiguas.", "Crea un pacchetto o scegline uno a sinistra. Spunta Software legacy per i programmi che servono solo alle macchine più vecchie."),
      T("Press Upload files or Upload a whole folder, or drag them onto the box. Keep the page open until every file says Uploaded.", "Pulse Subir archivos o Subir una carpeta completa, o arrástrelos al recuadro. Deje la página abierta hasta que cada archivo diga Subido.", "Premi Carica file o Carica un'intera cartella, oppure trascinali nel riquadro. Tieni la pagina aperta finché ogni file indica Caricato."),
    ],
    tip: T("A setup folder with thousands of small files downloads faster zipped into one file.", "Una carpeta de instalación con miles de archivos pequeños se descarga más rápido comprimida en un solo zip.", "Una cartella di installazione con migliaia di piccoli file si scarica più in fretta compressa in un unico zip."),
  },
  {
    id: "publish-kb", area: "kb", needs: ["kb.view", "kb.publish"],
    title: T("Publish an article to the customer help center", "Publicar un artículo en el centro de ayuda para clientes", "Pubblicare un articolo nel centro assistenza clienti"),
    summary: T("Customers can read it with no login. A scan stops anything with customer details first.", "Los clientes lo leen sin iniciar sesión. Antes, un análisis detiene cualquier dato de clientes.", "I clienti lo leggono senza accesso. Prima un controllo blocca qualsiasi dato dei clienti."),
    steps: [
      T("Open an article marked for customers and press Publish to help center.", "Abra un artículo marcado para clientes y pulse Publicar en el centro de ayuda.", "Apri un articolo destinato ai clienti e premi Pubblica nel centro assistenza."),
      T("Customer names and sites are hidden from customers on their own: they see [customer] or [site] instead, and you still see the whole article. If Customer details found appears, take out the machine number or password, or tick an email or phone number that is Ronchi's own, and publish again.", "Los nombres y plantas de clientes se ocultan solos a los clientes: ven [customer] o [site] en su lugar, y usted sigue viendo el artículo completo. Si aparece Se encontraron datos de clientes, quite el número de máquina o la contraseña, o marque un correo o teléfono que sea de Ronchi, y publique otra vez.", "I nomi e gli stabilimenti dei clienti vengono nascosti da soli ai clienti: vedono [customer] o [site] al loro posto, e tu continui a vedere l'articolo completo. Se compare Trovati dati di clienti, togli il numero macchina o la password, o spunta un'email o un telefono di Ronchi, e pubblica di nuovo."),
      T("After a change, press Publish changes. Take off help center removes it from customers.", "Después de un cambio, pulse Publicar cambios. Quitar del centro de ayuda lo retira para los clientes.", "Dopo una modifica premi Pubblica modifiche. Togli dal centro assistenza lo ritira per i clienti."),
    ],
    tip: T("Customers never see a customer's name, site or machine number. Names and sites are hidden for you; machine numbers and passwords must be taken out.", "Los clientes nunca ven el nombre, la planta ni el número de máquina de un cliente. Nombres y plantas se ocultan solos; números de máquina y contraseñas hay que quitarlos.", "I clienti non vedono mai nome, stabilimento o numero macchina di un cliente. Nomi e stabilimenti vengono nascosti da soli; numeri macchina e password vanno tolti."),
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
    id: "publish-catalog", area: "catalog", needs: ["catalog.view", "catalog.publish"],
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

  // ---------- Change parts: sales, then orders ----------
  {
    id: "view-cp-sales", area: "change-parts", needs: ["cpsales.view"],
    title: T("Follow change-part sales", "Seguir las ventas de cambio de formato", "Seguire le vendite cambio formato"),
    summary: T("Requests that aren't sold yet: who is working each one, its stage and when to follow up.", "Solicitudes aún no vendidas: quién lleva cada una, su etapa y cuándo dar seguimiento.", "Richieste non ancora vendute: chi segue ognuna, la fase e quando richiamare."),
    steps: [
      T("Open Change parts and press Sales.", "Abra Cambio de formato y pulse Ventas.", "Apri Cambio formato e premi Vendite."),
      T("The counts at the top show open sales, follow-ups that are due, quotes sent and lost sales. Pick a salesperson to see only theirs.", "Los totales de arriba muestran ventas abiertas, seguimientos pendientes, cotizaciones enviadas y ventas perdidas. Elija un vendedor para ver solo las suyas.", "I conteggi in alto mostrano vendite aperte, richiami da fare, offerte inviate e vendite perse. Scegli un venditore per vedere solo le sue."),
      T("Open a sale to see its details and its History.", "Abra una venta para ver sus datos y su Historial.", "Apri una vendita per vederne i dati e la Cronologia."),
    ],
  },
  {
    id: "start-cp-sale", area: "change-parts", needs: ["cpsales.view", "cpsales.edit"],
    title: T("Start and work a change-part sale", "Iniciar y llevar una venta de cambio de formato", "Avviare e seguire una vendita cambio formato"),
    summary: T("Log a customer's request for change parts and keep its stage current until the PO comes in.", "Registre la solicitud de un cliente y mantenga su etapa al día hasta que llegue la orden de compra.", "Registra la richiesta di un cliente e tieni aggiornata la fase finché arriva l'ordine d'acquisto."),
    steps: [
      T("In Change parts, Sales, press New sale.", "En Cambio de formato, Ventas, pulse Nueva venta.", "In Cambio formato, Vendite, premi Nuova vendita."),
      T("Fill in the customer, their contact, the machine and the part. You are the salesperson unless you change it.", "Complete el cliente, su contacto, la máquina y la pieza. Usted queda como vendedor salvo que lo cambie.", "Compila cliente, contatto, macchina e ricambio. Il venditore sei tu, a meno che non lo cambi."),
      T("As it moves, open it, press Edit and change the stage, quote number or follow-up date.", "A medida que avanza, ábrala, pulse Editar y cambie la etapa, el número de cotización o la fecha de seguimiento.", "Man mano che procede, aprila, premi Modifica e cambia fase, numero d'offerta o data di richiamo."),
      T("If the customer says no, set the stage to Lost.", "Si el cliente dice que no, ponga la etapa en Perdida.", "Se il cliente dice di no, imposta la fase su Persa."),
    ],
  },
  {
    id: "sell-cp-sale", area: "change-parts", needs: ["cpsales.edit", "orders.add"],
    title: T("Mark a sale sold", "Marcar una venta como vendida", "Segnare una vendita come venduta"),
    summary: T("When the customer's PO comes in, the sale becomes a change-part order.", "Cuando llega la orden de compra del cliente, la venta pasa a ser un pedido.", "Quando arriva l'ordine d'acquisto del cliente, la vendita diventa un ordine."),
    steps: [
      T("Open the sale and press Mark sold.", "Abra la venta y pulse Marcar vendida.", "Apri la vendita e premi Segna venduta."),
      T("Type the customer's PO. Add the AA number, RA PO and ship date if you have them.", "Escriba la orden de compra del cliente. Agregue el número AA, la orden RA y la fecha de envío si los tiene.", "Scrivi l'ordine d'acquisto del cliente. Aggiungi numero AA, ordine RA e data di spedizione se li hai."),
      T("Press Mark sold. It moves to Orders with its history.", "Pulse Marcar vendida. Pasa a Pedidos con su historial.", "Premi Segna venduta. Passa a Ordini con la sua cronologia."),
    ],
  },
  {
    id: "view-orders", area: "change-parts", needs: ["orders.view"],
    title: T("Follow change-part orders", "Seguir los pedidos de cambio de formato", "Seguire gli ordini cambio formato"),
    summary: T("See every sold job, through to shipped. No dollar amounts are kept here.", "Vea cada trabajo vendido, hasta el envío. Aquí no se guardan importes.", "Vedi ogni lavoro venduto, fino alla spedizione. Qui non si tengono importi."),
    steps: [
      T("Open Change parts. The counts at the top show open jobs, ones shipping soon and ones past their ship date.", "Abra Cambio de formato. Los totales de arriba muestran trabajos abiertos, próximos a enviar y atrasados.", "Apri Cambio formato. I conteggi in alto mostrano lavori aperti, in spedizione a breve e in ritardo."),
      T("Search by customer, machine, part, PO or notes, and filter by status.", "Busque por cliente, máquina, pieza, orden de compra o notas, y filtre por estado.", "Cerca per cliente, macchina, ricambio, ordine d'acquisto o note, e filtra per stato."),
      T("Open an order to see its details and its History.", "Abra un pedido para ver sus datos y su Historial.", "Apri un ordine per vederne i dati e la Cronologia."),
    ],
  },
  {
    id: "export-orders", area: "change-parts", needs: ["orders.view", "orders.export"],
    title: T("Download the orders as a spreadsheet", "Descargar los pedidos como hoja de cálculo", "Scaricare gli ordini come foglio di calcolo"),
    summary: T("Get the orders you're looking at in Excel.", "Obtenga en Excel los pedidos que está viendo.", "Porta in Excel gli ordini che stai guardando."),
    steps: [
      T("Open Change parts and search or filter to the orders you want.", "Abra Cambio de formato y busque o filtre los pedidos que quiere.", "Apri Cambio formato e cerca o filtra gli ordini che vuoi."),
      T("Press Export CSV. The file opens in Excel.", "Pulse Exportar CSV. El archivo se abre en Excel.", "Premi Esporta CSV. Il file si apre in Excel."),
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
      T("A shipped job stays open. When the customer approves the parts, open it and press Mark completed.", "Un trabajo enviado sigue abierto. Cuando el cliente apruebe las piezas, ábralo y pulse Marcar completado.", "Un lavoro spedito resta aperto. Quando il cliente approva i ricambi, aprilo e premi Segna completato."),
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

  // ---------- Machine sales ----------
  {
    id: "view-machine-deals", area: "machine-sales", needs: ["machinesales.view"],
    title: T("Follow machine deals", "Seguir los negocios de máquinas", "Seguire le trattative macchine"),
    summary: T("See every new-machine deal and where it stands.", "Vea cada negocio de máquina nueva y en qué punto está.", "Vedi ogni trattativa per una macchina nuova e a che punto è."),
    steps: [
      T("Open Sales, then Machine sales. The board has one column for each stage of the sale, from Lead to Won.", "Abra Ventas y luego Ventas de máquinas. El tablero tiene una columna por cada etapa de la venta, de Prospecto a Ganado.", "Apri Vendite, poi Vendite macchine. La bacheca ha una colonna per ogni fase della vendita, da Contatto a Vinta."),
      T("A card with a red edge has sat in its stage too long. A red label says what is missing, such as No next step.", "Una tarjeta con borde rojo lleva demasiado tiempo en su etapa. Una etiqueta roja dice qué falta, como Sin siguiente paso.", "Una scheda con il bordo rosso è ferma da troppo tempo nella sua fase. Un'etichetta rossa dice cosa manca, come Nessun prossimo passo."),
      T("Press Orders for machines that are sold and being built, On hold for postponed deals, and Closed for finished or lost ones.", "Pulse Pedidos para las máquinas vendidas y en fabricación, En espera para los negocios pospuestos y Cerrados para los terminados o perdidos.", "Premi Ordini per le macchine vendute e in costruzione, In sospeso per le trattative rimandate e Chiuse per quelle concluse o perse."),
      T("Open a deal to see its stage bar, what's due, its facts and its timeline.", "Abra un negocio para ver su barra de etapas, qué toca, sus datos y su cronología.", "Apri una trattativa per vedere la barra delle fasi, cosa c'è da fare, i dati e la cronologia."),
    ],
  },
  {
    id: "add-machine-deal", area: "machine-sales", needs: ["machinesales.view", "machinesales.add"],
    title: T("Start a machine deal", "Iniciar un negocio de máquina", "Avviare una trattativa macchina"),
    summary: T("Add a new lead or a deal already under way.", "Agregue un prospecto nuevo o un negocio ya en marcha.", "Aggiungi un nuovo contatto o una trattativa già avviata."),
    steps: [
      T("Open Machine sales and press New deal.", "Abra Ventas de máquinas y pulse Nuevo negocio.", "Apri Vendite macchine e premi Nuova trattativa."),
      T("Type the customer, the machine, the expected PO month and the salesperson. Pick the stage it is at now.", "Escriba el cliente, la máquina, el mes esperado de la OC y el vendedor. Elija la etapa en la que está ahora.", "Scrivi il cliente, la macchina, il mese previsto dell'ordine e il venditore. Scegli la fase in cui si trova ora."),
      T("Set a next step with a date, so the deal never sits without one. Press Add deal.", "Ponga un siguiente paso con fecha, para que el negocio nunca quede sin uno. Pulse Agregar negocio.", "Imposta un prossimo passo con una data, così la trattativa non resta mai senza. Premi Aggiungi trattativa."),
    ],
  },
  {
    id: "work-machine-deal", area: "machine-sales", needs: ["machinesales.view", "machinesales.edit"],
    title: T("Move a deal along and log calls", "Avanzar un negocio y registrar llamadas", "Far avanzare una trattativa e registrare le chiamate"),
    summary: T("Change the stage, log what happened and set the next step.", "Cambie la etapa, registre lo que pasó y ponga el siguiente paso.", "Cambia la fase, registra cos'è successo e imposta il prossimo passo."),
    steps: [
      T("Open the deal. Press a stage on the bar to move it there. Moving to Won asks for the customer's PO number.", "Abra el negocio. Pulse una etapa en la barra para moverlo allí. Pasar a Ganado pide el número de OC del cliente.", "Apri la trattativa. Premi una fase sulla barra per spostarla lì. Passare a Vinta chiede il numero d'ordine del cliente."),
      T("After a call or visit, pick Call or Visit under Log a call, visit or note, write what happened, set the next step and its date, and press Log it.", "Después de una llamada o visita, elija Llamada o Visita en Registrar una llamada, visita o nota, escriba lo que pasó, ponga el siguiente paso y su fecha, y pulse Registrar.", "Dopo una chiamata o visita, scegli Chiamata o Visita in Registra una chiamata, visita o nota, scrivi cos'è successo, imposta il prossimo passo e la data, e premi Registra."),
      T("Press Put on hold when a project is postponed and pick the date to reconnect. Press Mark lost and say why when the customer buys elsewhere.", "Pulse Poner en espera cuando un proyecto se pospone y elija la fecha para retomar el contacto. Pulse Marcar como perdido y diga por qué cuando el cliente compra en otro lado.", "Premi Metti in sospeso quando un progetto viene rimandato e scegli la data per ricontattare. Premi Segna come persa e indica perché quando il cliente compra altrove."),
      T("Press Edit to change any other detail.", "Pulse Editar para cambiar cualquier otro dato.", "Premi Modifica per cambiare qualsiasi altro dato."),
    ],
  },
  {
    id: "quote-machine-deal", area: "machine-sales", needs: ["machinesales.view", "machinesales.edit", "machinesales.prices"],
    title: T("Build and send a machine quote", "Preparar y enviar una cotización de máquina", "Preparare e inviare un'offerta macchina"),
    summary: T("Price a deal line by line, keep every revision, and print the quote.", "Ponga precio a un negocio línea por línea, conserve cada revisión e imprima la cotización.", "Dai un prezzo alla trattativa riga per riga, conserva ogni revisione e stampa l'offerta."),
    steps: [
      T("Open the deal and press New quote under Quotes. Add a line for each thing offered, say where it is built, and tick Option for extras the customer may add.", "Abra el negocio y pulse Nueva cotización en Cotizaciones. Agregue una línea por cada cosa ofrecida, indique dónde se fabrica y marque Opción para los extras que el cliente puede agregar.", "Apri la trattativa e premi Nuova offerta sotto Offerte. Aggiungi una riga per ogni cosa offerta, indica dove viene costruita e spunta Opzione per gli extra che il cliente può aggiungere."),
      T("Fill in the terms, press Save, then Print or save as PDF to get the quote to send.", "Complete las condiciones, pulse Guardar y luego Imprimir o guardar como PDF para obtener la cotización a enviar.", "Compila le condizioni, premi Salva, poi Stampa o salva come PDF per ottenere l'offerta da inviare."),
      T("Once it has gone to the customer, press Mark as sent. The deal's value becomes the quote's total and the deal moves to the quote stage.", "Cuando haya salido al cliente, pulse Marcar como enviada. El valor del negocio pasa a ser el total de la cotización y el negocio avanza a la etapa de cotización.", "Quando è partita per il cliente, premi Segna come inviata. Il valore della trattativa diventa il totale dell'offerta e la trattativa passa alla fase di offerta."),
      T("A sent quote is never changed. Press New revision to copy it, change the copy and send that. The one before shows as Replaced.", "Una cotización enviada nunca se cambia. Pulse Nueva revisión para copiarla, cambie la copia y envíela. La anterior aparece como Reemplazada.", "Un'offerta inviata non si modifica mai. Premi Nuova revisione per copiarla, modifica la copia e invia quella. La precedente risulta Sostituita."),
    ],
  },
  {
    id: "remove-machine-deal", area: "machine-sales", needs: ["machinesales.view", "machinesales.remove"],
    title: T("Remove a machine deal", "Quitar un negocio de máquina", "Rimuovere una trattativa macchina"),
    summary: T("Take a deal added by mistake off the list.", "Quite de la lista un negocio agregado por error.", "Togli dall'elenco una trattativa aggiunta per errore."),
    steps: [
      T("Open the deal and press Remove, then press it again to confirm.", "Abra el negocio y pulse Quitar, luego púlselo otra vez para confirmar.", "Apri la trattativa e premi Rimuovi, poi premilo di nuovo per confermare."),
      T("A deal the customer turned down is not removed: press Mark lost, so it stays in the record.", "Un negocio que el cliente rechazó no se quita: pulse Marcar como perdido, para que quede en el registro.", "Una trattativa rifiutata dal cliente non si rimuove: premi Segna come persa, così resta nel registro."),
    ],
  },
  {
    id: "machine-deal-values", area: "machine-sales", needs: ["machinesales.view", "machinesales.prices"],
    title: T("See what the pipeline is worth", "Ver cuánto vale el embudo", "Vedere quanto vale la pipeline"),
    summary: T("Deal values, open value and weighted value.", "Valores de los negocios, valor abierto y valor ponderado.", "Valori delle trattative, valore aperto e valore ponderato."),
    steps: [
      T("Open Machine sales. The boxes at the top show the open value and the weighted value of the deals being sold.", "Abra Ventas de máquinas. Los cuadros de arriba muestran el valor abierto y el valor ponderado de los negocios en venta.", "Apri Vendite macchine. I riquadri in alto mostrano il valore aperto e il valore ponderato delle trattative in corso."),
      T("The weighted value counts each deal by its chance to close. Each stage has a usual chance, and you can type your own on the deal.", "El valor ponderado cuenta cada negocio según su probabilidad de cierre. Cada etapa tiene una probabilidad habitual, y usted puede escribir la suya en el negocio.", "Il valore ponderato conta ogni trattativa secondo la sua probabilità di chiusura. Ogni fase ha una probabilità abituale, e puoi scrivere la tua nella trattativa."),
      T("People without this access see the same deals with no dollar amounts.", "Las personas sin este acceso ven los mismos negocios sin importes en dólares.", "Le persone senza questo accesso vedono le stesse trattative senza importi in dollari."),
    ],
  },

  // ---------- Inventory ----------
  {
    id: "view-stock", area: "inventory", needs: ["inventory.view"],
    title: T("Check what is in stock", "Ver qué hay en existencia", "Controllare cosa c'è a magazzino"),
    summary: T("Find a part, its shelf and how many are free to use.", "Encuentre una pieza, su estante y cuántas están libres para usar.", "Trova un ricambio, il suo scaffale e quanti sono liberi."),
    steps: [
      T("Open Warehouse, then Inventory. Search by part number, description or shelf.", "Abra Almacén y luego Inventario. Busque por número de pieza, descripción o estante.", "Apri Magazzino, poi Inventario. Cerca per codice ricambio, descrizione o scaffale."),
      T("On hand is what is on the shelves. Held is what confirmed parts orders will take. Available is what is left to promise.", "En existencia es lo que hay en los estantes. Apartado es lo que tomarán los pedidos confirmados. Disponible es lo que queda para prometer.", "Giacenza è ciò che c'è sugli scaffali. Impegnato è ciò che prenderanno gli ordini confermati. Disponibile è ciò che resta da promettere."),
      T("Press Low stock or Out of stock at the top to see what needs ordering.", "Pulse Existencias bajas o Agotado arriba para ver qué hay que pedir.", "Premi Scorta bassa o Esaurito in alto per vedere cosa va ordinato."),
      T("Open a part to see each shelf, the orders holding it, and every change ever made to its quantity.", "Abra una pieza para ver cada estante, los pedidos que la apartan y todos los cambios hechos a su cantidad.", "Apri un ricambio per vedere ogni scaffale, gli ordini che lo impegnano e tutte le variazioni della quantità."),
    ],
  },
  {
    id: "move-stock", area: "inventory", needs: ["inventory.view", "inventory.edit"],
    title: T("Put parts in, take them out, move them", "Ingresar, sacar y mover piezas", "Caricare, prelevare e spostare ricambi"),
    summary: T("Keep the count right every time a part moves.", "Mantenga el conteo correcto cada vez que una pieza se mueve.", "Tieni il conteggio corretto ogni volta che un ricambio si muove."),
    steps: [
      T("To add a part, open Inventory and press Put into stock. Type the part number, the shelf and the quantity.", "Para agregar una pieza, abra Inventario y pulse Ingresar al inventario. Escriba el número de pieza, el estante y la cantidad.", "Per aggiungere un ricambio, apri Inventario e premi Carica a magazzino. Scrivi il codice, lo scaffale e la quantità."),
      T("To take a part out, open the part, press Change stock, pick Take out, the shelf, the quantity and the reason.", "Para sacar una pieza, abra la pieza, pulse Cambiar existencias, elija Sacar, el estante, la cantidad y el motivo.", "Per prelevare un ricambio, aprilo, premi Modifica giacenza, scegli Preleva, lo scaffale, la quantità e il motivo."),
      T("Most stock changes by itself. Checking a delivery in under Shipping and receiving puts its parts on the shelf you typed, and marking a shipment shipped takes its parts off. Parts on quality hold are not in stock until the hold is cleared.", "La mayoría de las existencias cambian solas. Al registrar una entrega en Envíos y recepción sus piezas van al estante que escribió, y al marcar un envío como enviado sus piezas salen. Las piezas en retención de calidad no están en existencia hasta que se libera la retención.", "La maggior parte delle giacenze cambia da sola. Registrando una consegna in Spedizioni e ricevimento i ricambi vanno sullo scaffale indicato, e segnando una spedizione come spedita i ricambi escono. I ricambi in blocco qualità non sono a magazzino finché il blocco non viene tolto."),
      T("To move it, pick Move to another shelf. The portal will not let a shelf go below zero.", "Para moverla, elija Mover a otro estante. El portal no deja que un estante quede bajo cero.", "Per spostarlo, scegli Sposta su un altro scaffale. Il portale non lascia scendere uno scaffale sotto zero."),
    ],
  },
  {
    id: "correct-stock", area: "inventory", needs: ["inventory.view", "inventory.adjust"],
    title: T("Correct a count or import a stock list", "Corregir un conteo o importar una lista", "Correggere un conteggio o importare un elenco"),
    summary: T("Fix a wrong number with a reason, set reorder points, or load a spreadsheet.", "Corrija un número equivocado con un motivo, ponga puntos de pedido o cargue una hoja de cálculo.", "Correggi un numero sbagliato con un motivo, imposta i punti di riordino o carica un foglio di calcolo."),
    steps: [
      T("Open the part, press Change stock and pick Correct the count. Type what you counted on that shelf and pick a reason.", "Abra la pieza, pulse Cambiar existencias y elija Corregir el conteo. Escriba lo que contó en ese estante y elija un motivo.", "Apri il ricambio, premi Modifica giacenza e scegli Correggi il conteggio. Scrivi quanto hai contato su quello scaffale e scegli un motivo."),
      T("Press Edit details to set the usual shelf, the reorder point and the reorder quantity. The part shows as Low stock when what is available falls to the reorder point.", "Pulse Editar datos para poner el estante habitual, el punto de pedido y la cantidad a pedir. La pieza aparece con Existencias bajas cuando lo disponible llega al punto de pedido.", "Premi Modifica dati per impostare lo scaffale abituale, il punto di riordino e la quantità di riordino. Il ricambio risulta Scorta bassa quando il disponibile scende al punto di riordino."),
      T("To load a whole list, press Import a stock list on the Inventory page and choose a CSV file with Part number and Quantity columns.", "Para cargar una lista completa, pulse Importar una lista de existencias en la página Inventario y elija un archivo CSV con las columnas Part number y Quantity.", "Per caricare un elenco intero, premi Importa un elenco di giacenze nella pagina Inventario e scegli un file CSV con le colonne Part number e Quantity."),
    ],
  },
  {
    id: "stock-costs", area: "inventory", needs: ["inventory.view", "inventory.prices"],
    title: T("See what the stock is worth", "Ver cuánto vale el inventario", "Vedere quanto vale il magazzino"),
    summary: T("Part costs and the value of what is on the shelves.", "Costos de las piezas y el valor de lo que hay en los estantes.", "Costi dei ricambi e valore di ciò che c'è sugli scaffali."),
    steps: [
      T("Open Inventory. The Stock value box at the top adds up on hand times cost for every part that has a cost.", "Abra Inventario. El cuadro Valor del inventario de arriba suma existencia por costo de cada pieza que tiene costo.", "Apri Inventario. Il riquadro Valore di magazzino in alto somma giacenza per costo di ogni ricambio che ha un costo."),
      T("People without this access see the same stock with no dollar amounts.", "Las personas sin este acceso ven las mismas existencias sin importes en dólares.", "Le persone senza questo accesso vedono le stesse giacenze senza importi in dollari."),
    ],
  },

  // ---------- Parts orders ----------
  {
    id: "view-parts-orders", area: "parts-orders", needs: ["partsorders.view"],
    title: T("Follow parts orders", "Seguir los pedidos de repuestos", "Seguire gli ordini ricambi"),
    summary: T("See where every spare parts order is, and what is late.", "Vea dónde está cada pedido de repuestos y qué está atrasado.", "Vedi a che punto è ogni ordine ricambi e cosa è in ritardo."),
    steps: [
      T("Open Parts orders. The counts at the top show open quotes, orders waiting on parts, ready to ship, shipped but not invoiced, and late.", "Abra Pedidos de repuestos. Los totales de arriba muestran cotizaciones abiertas, pedidos esperando repuestos, listos para enviar, enviados sin facturar y atrasados.", "Apri Ordini ricambi. I conteggi in alto mostrano offerte aperte, ordini in attesa dei ricambi, pronti da spedire, spediti non fatturati e in ritardo."),
      T("Search by order number, customer, machine, PO or part number.", "Busque por número de pedido, cliente, máquina, OC o número de repuesto.", "Cerca per numero d'ordine, cliente, macchina, ordine d'acquisto o codice ricambio."),
      T("Open an order. The line at the top says where it is and what happens next. Below are its parts, when each arrives, and its History.", "Abra un pedido. La línea de arriba dice dónde está y qué sigue. Abajo están sus repuestos, cuándo llega cada uno y su Historial.", "Apri un ordine. La riga in alto dice a che punto è e cosa succede dopo. Sotto ci sono i ricambi, quando arriva ognuno e la Cronologia."),
    ],
  },
  {
    id: "add-parts-order", area: "parts-orders", needs: ["partsorders.view", "partsorders.add"],
    title: T("Start a parts order", "Iniciar un pedido de repuestos", "Avviare un ordine ricambi"),
    summary: T("From a phone call, an email, a quote request, or an old order.", "Desde una llamada, un correo, una solicitud de cotización o un pedido anterior.", "Da una telefonata, un'email, una richiesta di offerta o un vecchio ordine."),
    steps: [
      T("Press New order. Fill in the customer, the machine and the parts with their quantities, then press Add order.", "Pulse Nuevo pedido. Complete el cliente, la máquina y los repuestos con sus cantidades, y pulse Agregar pedido.", "Premi Nuovo ordine. Compila cliente, macchina e ricambi con le quantità, poi premi Aggiungi ordine."),
      T("When a customer sends a quote request from the parts site, open it and press Make parts order. Its parts come across, nothing typed twice.", "Cuando un cliente envía una solicitud de cotización desde el sitio de repuestos, ábrala y pulse Crear pedido de repuestos. Sus repuestos pasan solos, sin escribir dos veces.", "Quando un cliente invia una richiesta di offerta dal sito ricambi, aprila e premi Crea ordine ricambi. I ricambi passano da soli, senza riscrivere nulla."),
      T("To repeat an old order, open it and press Order again.", "Para repetir un pedido anterior, ábralo y pulse Pedir de nuevo.", "Per ripetere un vecchio ordine, aprilo e premi Ordina di nuovo."),
    ],
  },
  {
    id: "edit-parts-order", area: "parts-orders", needs: ["partsorders.view", "partsorders.edit"],
    title: T("Move an order along", "Hacer avanzar un pedido", "Far avanzare un ordine"),
    summary: T("Quote, take the PO, order from the supplier, receive and ship.", "Cotizar, recibir la OC, pedir al proveedor, recibir y enviar.", "Offerta, ordine del cliente, ordine al fornitore, arrivo e spedizione."),
    steps: [
      T("Change the status at the top when you send the quote and when the customer's PO comes in.", "Cambie el estado arriba cuando envíe la cotización y cuando llegue la OC del cliente.", "Cambia lo stato in alto quando invii l'offerta e quando arriva l'ordine del cliente."),
      T("Open To order from suppliers to see every part still to order, by supplier. Copy list gives you the text for the order email to Italy.", "Abra Por pedir a proveedores para ver cada repuesto pendiente, por proveedor. Copiar lista le da el texto para el correo de pedido a Italia.", "Apri Da ordinare ai fornitori per vedere ogni ricambio ancora da ordinare, per fornitore. Copia elenco ti dà il testo per l'email d'ordine all'Italia."),
      T("Press Edit and type the supplier PO and arrival date on each line, then how many arrived and shipped. The status moves on by itself.", "Pulse Editar y escriba en cada línea la OC al proveedor y la fecha de llegada, luego cuántos llegaron y se enviaron. El estado avanza solo.", "Premi Modifica e scrivi su ogni riga l'ordine fornitore e la data di arrivo, poi quanti sono arrivati e spediti. Lo stato avanza da solo."),
      T("Once it ships, type the QuickBooks invoice number, then close it when it's paid.", "Cuando se envíe, escriba el número de factura de QuickBooks y ciérrelo cuando esté pagado.", "Quando è spedito, scrivi il numero di fattura QuickBooks e chiudilo quando è pagato."),
    ],
    tip: T("If someone else saved the order while you were editing, the portal stops you so nothing is overwritten. Reload and try again.", "Si otra persona guardó el pedido mientras usted editaba, el portal lo detiene para no sobrescribir nada. Recargue e intente otra vez.", "Se qualcun altro ha salvato l'ordine mentre lo modificavi, il portale ti ferma per non sovrascrivere nulla. Ricarica e riprova."),
  },
  {
    id: "remove-parts-order", area: "parts-orders", needs: ["partsorders.view", "partsorders.remove"],
    title: T("Remove a parts order", "Quitar un pedido de repuestos", "Rimuovere un ordine ricambi"),
    summary: T("Take an order typed by mistake off the list. It stays in the record.", "Quite de la lista un pedido escrito por error. Queda en el registro.", "Togli dall'elenco un ordine inserito per errore. Resta nell'archivio."),
    steps: [
      T("Open the order and press Remove, then Yes, remove.", "Abra el pedido y pulse Eliminar, luego Sí, eliminar.", "Apri l'ordine e premi Rimuovi, poi Sì, rimuovi."),
      T("For a sale that didn't happen, set the status to Lost and say why instead, so it counts in the win rate.", "Para una venta que no se dio, ponga el estado en Perdido y diga por qué, así cuenta en la tasa de éxito.", "Per una vendita non andata a buon fine, metti lo stato Perso e indica il motivo, così conta nella percentuale di successo."),
    ],
  },
  {
    id: "parts-prices", area: "parts-orders", needs: ["partsorders.view", "partsorders.prices"],
    title: T("Prices, discounts and margin", "Precios, descuentos y margen", "Prezzi, sconti e margine"),
    summary: T("Only people allowed to see parts prices see any dollar amounts.", "Solo quienes pueden ver precios de repuestos ven montos en dólares.", "Solo chi può vedere i prezzi dei ricambi vede importi in dollari."),
    steps: [
      T("In Edit, type each line's price and our cost, plus any discount and freight for the order.", "En Editar, escriba el precio de cada línea y nuestro costo, más el descuento y el flete del pedido.", "In Modifica, scrivi il prezzo di ogni riga e il nostro costo, più eventuale sconto e trasporto dell'ordine."),
      T("The order shows its total and margin. A margin under 20% shows in red.", "El pedido muestra su total y margen. Un margen menor al 20% se ve en rojo.", "L'ordine mostra totale e margine. Un margine sotto il 20% appare in rosso."),
    ],
  },
  {
    id: "export-parts-orders", area: "parts-orders", needs: ["partsorders.view", "partsorders.export"],
    title: T("Download parts orders as a spreadsheet", "Descargar los pedidos de repuestos como hoja de cálculo", "Scaricare gli ordini ricambi come foglio di calcolo"),
    summary: T("Get the parts orders you're looking at in Excel.", "Obtenga en Excel los pedidos de repuestos que está viendo.", "Porta in Excel gli ordini ricambi che stai guardando."),
    steps: [
      T("Open Parts orders and search to the orders you want.", "Abra Pedidos de repuestos y busque los pedidos que quiere.", "Apri Ordini ricambi e cerca gli ordini che vuoi."),
      T("Press Export CSV. The file opens in Excel. Totals are in it only if you can see parts prices.", "Pulse Exportar CSV. El archivo se abre en Excel. Los totales solo aparecen si puede ver los precios de repuestos.", "Premi Esporta CSV. Il file si apre in Excel. I totali ci sono solo se puoi vedere i prezzi dei ricambi."),
    ],
  },
  {
    id: "parts-reports", area: "parts-orders", needs: ["partsorders.view", "partsorders.prices", "partsorders.reports"],
    title: T("Parts sales reports", "Informes de ventas de repuestos", "Report vendite ricambi"),
    summary: T("Sales by month, top customers and parts, win rate and how fast orders ship.", "Ventas por mes, mejores clientes y repuestos, tasa de éxito y rapidez de envío.", "Vendite per mese, clienti e ricambi principali, percentuale di successo e rapidità di spedizione."),
    steps: [
      T("Open Parts orders, then Sales reports. Pick the dates at the top.", "Abra Pedidos de repuestos y luego Informes de ventas. Elija las fechas arriba.", "Apri Ordini ricambi, poi Report vendite. Scegli le date in alto."),
      T("Sales count from the day the customer's PO came in. Lost and cancelled orders are left out.", "Las ventas cuentan desde el día en que llegó la OC del cliente. Los pedidos perdidos y cancelados no cuentan.", "Le vendite contano dal giorno in cui è arrivato l'ordine del cliente. Ordini persi e annullati sono esclusi."),
    ],
  },

  // ---------- People and access (admins) ----------
  {
    id: "invite-employee", area: "people", needs: ["users.manage"],
    title: T("Add an employee", "Agregar un empleado", "Aggiungere un dipendente"),
    summary: T("Add a new person with a username. They choose their own password the first time they sign in.", "Agregue a una persona nueva con un nombre de usuario. Ella elige su propia contraseña la primera vez que inicia sesión.", "Aggiungi una persona nuova con un nome utente. Sceglie la propria password al primo accesso."),
    steps: [
      T("Open People, then Employees, and find Add an employee.", "Abra Personas, luego Empleados, y busque Agregar un empleado.", "Apri Persone, poi Dipendenti, e cerca Aggiungi un dipendente."),
      T("Type their full name, work email or a username, and pick their role.", "Escriba su nombre completo, correo de trabajo o un nombre de usuario, y elija su rol.", "Scrivi nome completo, email di lavoro o un nome utente, e scegli il ruolo."),
      T("Press Add employee, then tell them the portal's address and their username. Their first sign-in is open for 3 days.", "Pulse Añadir empleado y dígale la dirección del portal y su nombre de usuario. Su primer inicio de sesión está abierto 3 días.", "Premi Aggiungi dipendente, poi comunica l'indirizzo del portale e il nome utente. Il primo accesso resta aperto 3 giorni."),
      T("Forgot password? Press Reset password next to their name. They choose a new one at their next sign-in.", "¿Olvidó la contraseña? Pulse Restablecer contraseña junto a su nombre. Elegirá una nueva en su próximo inicio de sesión.", "Password dimenticata? Premi Reimposta password accanto al nome. Ne sceglierà una nuova al prossimo accesso."),
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
    id: "workbook-switch", area: "people", needs: ["settings.manage"], open: "/settings",
    title: T("Switch the Ronchi workbook on or off", "Encender o apagar el cuaderno de trabajo Ronchi", "Accendere o spegnere il quaderno di lavoro Ronchi"),
    summary: T("If the team keeps its Excel sheets, hide the Work order tab on jobs for everyone.", "Si el equipo sigue con sus hojas de Excel, oculte la pestaña Orden de trabajo de los trabajos para todos.", "Se il team continua con i fogli Excel, nascondi a tutti la scheda Ordine di lavoro dei lavori."),
    steps: [
      T("Open Settings, press Command center and find Use the Ronchi workbook under Sections of the portal.", "Abra Configuración, pulse Centro de mando y busque Usar el cuaderno de trabajo Ronchi en Secciones del portal.", "Apri Impostazioni, premi Centro di comando e cerca Usa il quaderno di lavoro Ronchi in Sezioni del portale."),
      T("Untick it and confirm. Jobs, job emails and job files keep working, and nothing is deleted.", "Desmárquelo y confirme. Los trabajos, sus correos y archivos siguen funcionando y no se borra nada.", "Togli la spunta e conferma. Lavori, email e file dei lavori continuano a funzionare e non si cancella nulla."),
    ],
  },
  {
    id: "admin-controls", area: "people", needs: ["settings.manage"], open: "/settings",
    title: T("Use the command center", "Usar el centro de mando", "Usare il centro di comando"),
    summary: T("Only the portal owner sees it: every section's on/off switch, usage, a notice for everyone, sign-in, chat limits, languages, looks and emergency sign-out.", "Solo el dueño del portal lo ve: el interruptor de cada sección, uso, un aviso para todos, inicio de sesión, límites de chat, idiomas, aspectos y cierre de sesión de emergencia.", "Lo vede solo il proprietario del portale: l'interruttore di ogni sezione, utilizzo, un avviso per tutti, accesso, limiti delle chat, lingue, aspetti e disconnessione di emergenza."),
    steps: [
      T("Open Settings and press Command center.", "Abra Configuración y pulse Centro de mando.", "Apri Impostazioni e premi Centro di comando."),
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
  // ---------- Shipping and receiving ----------
  {
    id: "track-shipments", area: "shipping", needs: ["shipping.view"],
    title: T("See what's shipping and track it", "Ver qué se envía y seguirlo", "Vedere cosa parte e seguirlo"),
    summary: T("Everything going out and coming in, with tracking links to the carrier's own page.", "Todo lo que sale y entra, con enlaces de seguimiento a la página del transportista.", "Tutto ciò che esce ed entra, con link di tracciamento alla pagina del vettore."),
    steps: [
      T("Open Shipping and receiving. The counters at the top show what's waiting to be packed, on the way, expected in and any problems.", "Abra Envíos y recepción. Los contadores de arriba muestran lo que falta empacar, lo que va en camino, lo que se espera y los problemas.", "Apri Spedizioni e ricevimento. I contatori in alto mostrano cosa è da imballare, in viaggio, in arrivo e gli eventuali problemi."),
      T("Search by shipment number, customer, supplier, machine, PO, tracking number or part number.", "Busque por número de envío, cliente, proveedor, máquina, PO, número de seguimiento o de pieza.", "Cerca per numero di spedizione, cliente, fornitore, macchina, PO, numero di tracciamento o codice ricambio."),
      T("Press a tracking number to open the carrier's tracking page. For LTL freight the number is copied: paste it on the carrier's page.", "Pulse un número de seguimiento para abrir la página del transportista. Para carga LTL el número se copia: péguelo en la página del transportista.", "Premi un numero di tracciamento per aprire la pagina del vettore. Per il groupage LTL il numero viene copiato: incollalo nella pagina del vettore."),
      T("Add photos and papers to any shipment, like proof of delivery or damage photos.", "Añada fotos y documentos a cualquier envío, como el comprobante de entrega o fotos de daños.", "Aggiungi foto e documenti a qualsiasi spedizione, come la prova di consegna o le foto dei danni."),
    ],
    tip: T("Change-part orders, jobs and machines show their shipments at the bottom of their page.", "Los pedidos de cambio de formato, los trabajos y las máquinas muestran sus envíos al final de su página.", "Ordini cambio formato, lavori e macchine mostrano le loro spedizioni in fondo alla pagina."),
  },
  {
    id: "ship-out", area: "shipping", needs: ["shipping.view", "shipping.edit"],
    title: T("Ship something out", "Enviar algo", "Spedire qualcosa"),
    summary: T("Make a shipment, print the packing slip and bill of lading, and mark it shipped.", "Cree un envío, imprima el albarán y el conocimiento de embarque, y márquelo como enviado.", "Crea una spedizione, stampa la distinta di imballo e la lettera di vettura, e segnala come spedita."),
    steps: [
      T("On a change-part order or job, press Ship this. Or open Shipping and press New shipment.", "En un pedido de cambio de formato o trabajo, pulse Enviar esto. O abra Envíos y pulse Nuevo envío.", "In un ordine cambio formato o un lavoro, premi Spedisci. Oppure apri Spedizioni e premi Nuova spedizione."),
      T("Check the customer and address, add the packages (crates, pallets, boxes with weight and size) and what's in it.", "Revise el cliente y la dirección, añada los bultos (cajas, pallets, con peso y medidas) y su contenido.", "Controlla cliente e indirizzo, aggiungi i colli (casse, pallet, scatole con peso e misure) e il contenuto."),
      T("Press Packing slip or Bill of lading to print them or save them as PDF.", "Pulse Albarán o Conocimiento de embarque para imprimirlos o guardarlos como PDF.", "Premi Distinta di imballo o Lettera di vettura per stamparle o salvarle in PDF."),
      T("When it leaves, press Mark shipped and type the tracking or PRO numbers. Then Email the customer sends them the tracking.", "Cuando salga, pulse Marcar enviado y escriba los números de seguimiento o PRO. Luego Enviar correo al cliente le manda el seguimiento.", "Quando parte, premi Segna come spedita e scrivi i numeri di tracciamento o PRO. Poi Scrivi al cliente gli manda il tracciamento."),
    ],
    tip: T("Shipping a change-part order fills in the order's ship date and moves it to Shipped.", "Enviar un pedido de cambio de formato completa su fecha de envío y lo pasa a Enviado.", "Spedire un ordine cambio formato compila la data di spedizione e lo porta a Spedito."),
  },
  {
    id: "receive", area: "shipping", needs: ["shipping.view", "shipping.edit"],
    title: T("Check a delivery in", "Recibir una entrega", "Registrare una consegna"),
    summary: T("Expect a delivery, count what came in (a bit at a time if needed), note where it went and anything wrong.", "Espere una entrega, cuente lo que llegó (por partes si hace falta), anote dónde se guardó y cualquier problema.", "Prevedi una consegna, conta cosa è arrivato (anche a più riprese), annota dove è stato messo e ogni problema."),
    steps: [
      T("Open Shipping and receiving and press Expect a delivery. Add the supplier or customer, the PO or RMA number and what's coming.", "Abra Envíos y recepción y pulse Esperar una entrega. Añada el proveedor o cliente, el número de PO o RMA y lo que viene.", "Apri Spedizioni e ricevimento e premi Prevedi una consegna. Aggiungi fornitore o cliente, numero di PO o RMA e cosa arriva."),
      T("For shipments from Italy, add how it travels, the vessel or flight, the container and the customs broker.", "Para envíos de Italia, añada cómo viaja, el barco o vuelo, el contenedor y el agente de aduanas.", "Per le spedizioni dall'Italia, aggiungi il mezzo, la nave o il volo, il container e lo spedizioniere doganale."),
      T("When it arrives, type how many of each item came in and the shelf or bin, then press Check in what I counted. Or press Everything arrived.", "Cuando llegue, escriba cuántas unidades de cada artículo llegaron y el estante o casillero, y pulse Registrar lo que conté. O pulse Llegó todo.", "Quando arriva, scrivi quanti pezzi di ogni articolo sono arrivati e lo scaffale o il contenitore, poi premi Registra quello che ho contato. Oppure premi È arrivato tutto."),
      T("If something is wrong, pick it under Anything wrong? and add photos. Tick Hold to keep a doubtful part from being used.", "Si algo está mal, elíjalo en ¿Algún problema? y añada fotos. Marque Retener para que una pieza dudosa no se use.", "Se qualcosa non va, sceglilo in Qualche problema? e aggiungi foto. Spunta Blocca per non far usare un pezzo dubbio."),
    ],
    tip: T("Receiving a customer's sample bottles for a change-part order fills in its samples received date.", "Recibir las botellas de muestra de un cliente para un pedido de cambio de formato completa su fecha de muestras recibidas.", "Ricevere i flaconi campione di un cliente per un ordine cambio formato compila la data di campioni ricevuti."),
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
