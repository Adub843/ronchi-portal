// Spanish and Italian for username and password sign-in (2026-11-26). i18n-dict.ts adds these in.
// [English, Spanish, Italian]
const P: [string, string, string][] = [
  ["Add employee", "Agregar empleado", "Aggiungi dipendente"],
  ["Added. Their username is {login}", "Agregado. Su usuario es {login}", "Aggiunto. Il suo nome utente è {login}"],
  ["For a forgotten password. They make a new one at their next sign-in.", "Para una contraseña olvidada. Creará una nueva al iniciar sesión la próxima vez.", "Per una password dimenticata. Ne creerà una nuova al prossimo accesso."],
  ["New here, or forgot your password? Ask your admin.", "¿Es nuevo u olvidó su contraseña? Pregunte a su administrador.", "Sei nuovo o hai dimenticato la password? Chiedi al tuo amministratore."],
  ["New password", "Nueva contraseña", "Nuova password"],
  ["No password yet: makes one at first sign-in", "Aún sin contraseña: la crea al iniciar sesión por primera vez", "Ancora senza password: la crea al primo accesso"],
  ["Password cleared and signed out. Next time they sign in, they make a new one.", "Contraseña borrada y sesión cerrada. La próxima vez que inicie sesión, creará una nueva.", "Password cancellata e disconnesso. Al prossimo accesso ne creerà una nuova."],
  ["Password set", "Contraseña creada", "Password impostata"],
  ["Reset password", "Restablecer contraseña", "Reimposta password"],
  ["Restored. They can sign in again with their username and password.", "Restaurado. Puede volver a iniciar sesión con su usuario y contraseña.", "Ripristinato. Può accedere di nuovo con nome utente e password."],
  ["Save password and sign in", "Guardar contraseña e iniciar sesión", "Salva la password e accedi"],
  ["Sign in", "Iniciar sesión", "Accedi"],
  ["Signing in…", "Iniciando sesión…", "Accesso in corso…"],
  ["Staff sign-in.", "Acceso del personal.", "Accesso del personale."],
  ["Tell them to open the portal and sign in with that username. The first time, it asks them to make their own password.", "Dígale que abra el portal e inicie sesión con ese usuario. La primera vez le pedirá que cree su propia contraseña.", "Digli di aprire il portale e accedere con quel nome utente. La prima volta gli chiederà di creare la propria password."],
  ["The two passwords don't match.", "Las dos contraseñas no coinciden.", "Le due password non coincidono."],
  ["This is your first sign-in. Make your own password: at least 8 characters.", "Es su primer inicio de sesión. Cree su propia contraseña: al menos 8 caracteres.", "Questo è il tuo primo accesso. Crea la tua password: almeno 8 caratteri."],
  ["Type it again", "Escríbala otra vez", "Scrivila di nuovo"],
  ["Username", "Usuario", "Nome utente"],
  ["Your username is {email}. Make your own password: at least 8 characters.", "Su usuario es {email}. Cree su propia contraseña: al menos 8 caracteres.", "Il tuo nome utente è {email}. Crea la tua password: almeno 8 caratteri."],
  ["{s} signed in", "{s} con sesión iniciada", "{s} con accesso attivo"],
  ["Wrong username or password.", "Usuario o contraseña incorrectos.", "Nome utente o password errati."],
];

export const PASSWORD_ES: Record<string, string> = Object.fromEntries(P.map(([en, es]) => [en, es]));
export const PASSWORD_IT: Record<string, string> = Object.fromEntries(P.map(([en, , it]) => [en, it]));
