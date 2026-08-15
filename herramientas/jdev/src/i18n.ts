/**
 * i18n — neutral Spanish (es) and English (en), shared by the interactive
 * TUI and the human-facing verdicts of the plain subcommands.
 *
 * Language resolution order:
 *   1. `--lang <es|en>` global CLI flag (valid before or after a subcommand)
 *   2. `JDEV_LANG` environment variable
 *   3. system locale (LC_ALL / LC_MESSAGES / LANG starts with "es")
 *   4. fallback: Spanish
 *
 * Raw data output (uuid lines, hashes, CSV/JSON results) stays language-free;
 * only message surfaces (prompts, verdicts, errors) are localized.
 */

export type Lang = 'es' | 'en'

export const es = {
  titleTail: 'CLI Dev Toolkit · menú interactivo',
  mainMenu: 'Selecciona una opción',
  mUuid: 'UUID — generar identificadores (v4 / v7)',
  mUuidDesc: 'RFC 4122 y RFC 9562',
  mJson: 'JSON — validar / formatear / minificar',
  mJsonDesc: 'archivo o texto',
  mBase64: 'Base64 — encode / decode (RFC 4648)',
  mBase64Desc: 'estándar o URL-safe',
  mTimestamp: 'Timestamp — epoch ↔ ISO 8601',
  mTimestampDesc: 'UTC u offset local',
  mHash: 'Hash — sha256 / sha512 streaming',
  mHashDesc: 'archivo o stdin',
  mPassword: 'Password — bcrypt hash / verify / generate',
  mPasswordDesc: 'con guard de 72 bytes',
  mJwt: 'JWT — decodificar token (solo lectura)',
  mJwtDesc: 'la firma nunca se imprime',
  mCsv: 'CSV — info / format / tojson',
  mCsvDesc: 'parser RFC 4180 streaming',
  mHttp: 'HTTP — peticiones con secrets enmascarados',
  mHttpDesc: 'mini-curl interactivo',
  mFree: 'Modo libre — ejecutar un comando jdev completo',
  mFreeDesc: 'ej: uuid --v7 --count 3',
  mLang: 'Idioma (es / en)',
  mLangDesc: 'cambiar el idioma de la interfaz',
  mLangMenu: 'Idioma — selecciona',
  langSet: 'Idioma configurado: {lang}',
  tuiRequiresTty: 'el TUI requiere una terminal interactiva (TTY); usa los subcomandos (jdev <cmd>) para scripts y automatización',
  mQuit: 'Salir',
  freePrompt: 'Comando (ej: "uuid --v7 --count 3")',
  goodbye: '¡Hasta pronto!',
  closing: 'Cerrando…',
  backToMain: '← Volver al menú principal',
  backPrompt: 'Presiona Enter para volver al menú principal',
  moreLines: '… {n} líneas más',
  askPath: 'Ruta del {what} (Enter vacío para cancelar)',
  notAFile: 'no es un archivo',
  cannotRead: "no se pudo leer '{path}'",
  // uuid
  uuidVersion: 'UUID — versión',
  uuidV4: 'v4 — aleatorio (RFC 4122)',
  uuidV7: 'v7 — ordenado por tiempo (RFC 9562)',
  uuidCount: 'Cantidad (1–1000)',
  range1000: 'entre 1 y 1000',
  // json
  jsonAction: 'JSON — acción',
  jsonFormat: 'Formatear (pretty 2 espacios)',
  jsonMinify: 'Minificar (una línea)',
  jsonValidate: 'Validar (silencioso → veredicto)',
  jsonPath: 'archivo JSON',
  validJson: 'JSON válido',
  invalidJsonAt: 'JSON inválido en línea {line}, columna {column}',
  // base64
  b64Action: 'Base64 — acción',
  b64Encode: 'Codificar (texto → base64)',
  b64Decode: 'Decodificar (base64 → texto)',
  b64Variant: 'Variante',
  b64Std: 'Estándar (RFC 4648, con padding)',
  b64Url: 'URL-safe (JWT, sin padding)',
  b64TextIn: 'Texto a codificar',
  b64StrIn: 'Cadena base64',
  // timestamp
  tsMode: 'Timestamp — modo',
  tsNow: 'Ahora (reloj actual)',
  tsConvert: 'Convertir un epoch',
  tsUnit: 'Unidad',
  tsSeconds: 'Segundos',
  tsMillis: 'Milisegundos',
  tsOut: 'Salida',
  tsDigits: 'Epoch (número)',
  tsUtc: 'ISO 8601 UTC',
  tsLocal: 'ISO 8601 con offset local',
  tsInput: 'Epoch a convertir',
  // hash
  hashPath: 'archivo a hashear',
  hashAlgo: 'Algoritmo',
  // password
  pwAction: 'Password — acción',
  pwGen: 'Generar contraseña aleatoria',
  pwHash: 'Hashear contraseña (bcrypt)',
  pwVerify: 'Verificar contraseña',
  pwLen: 'Longitud (1–1024)',
  range1024: 'entre 1 y 1024',
  pwPrompt: 'Contraseña',
  pwEmpty: 'contraseña vacía',
  pwCost: 'Cost factor (4–31)',
  range431: 'entre 4 y 31',
  pwVerifyPrompt: 'Contraseña a verificar',
  hashInput: 'Hash bcrypt',
  pwMatch: 'Contraseña correcta',
  pwMalformed: 'hash malformado (esperado $2a/$2b/$2y + cost + 53 caracteres)',
  pwMismatch: 'Contraseña incorrecta',
  secretNote: '(los secretos no se muestran por seguridad; el comando funciona con tus valores)',
  // jwt
  jwtToken: 'Token JWT',
  jwtHeader: 'JWT — header',
  jwtPayload: 'JWT — payload',
  jwtSigNote: '(la firma no se decodifica por diseño)',
  // csv
  csvAction: 'CSV — acción',
  csvInfo: 'Info (filas / columnas)',
  csvFormat: 'Formatear (normalizar RFC 4180)',
  csvToJson: 'Convertir a JSON',
  csvPath: 'archivo CSV',
  // http
  httpUrl: 'URL (http://…)',
  httpUrlBad: 'URL inválida: debe empezar con http:// o https://',
  httpMethod: 'Método',
  httpBody: 'Body (Enter vacío para ninguno)',
  httpHeader: 'Header {i} "Name: value" (Enter vacío para terminar)',
  httpHeaderBad: "ignorado: falta ':' en '{h}'",
  httpTimeout: 'Timeout (segundos, 1–600)',
  range600: 'entre 1 y 600',
  httpTls: '¿Ignorar verificación TLS (--insecure)?',
  sending: 'enviando…',
  masked: '***',
} as const

export type MsgKey = keyof typeof es

export const en: Record<MsgKey, string> = {
  titleTail: 'CLI Dev Toolkit · interactive menu',
  mainMenu: 'Select an option',
  mUuid: 'UUID — generate identifiers (v4 / v7)',
  mUuidDesc: 'RFC 4122 & RFC 9562',
  mJson: 'JSON — validate / format / minify',
  mJsonDesc: 'file or text',
  mBase64: 'Base64 — encode / decode (RFC 4648)',
  mBase64Desc: 'standard or URL-safe',
  mTimestamp: 'Timestamp — epoch ↔ ISO 8601',
  mTimestampDesc: 'UTC or local offset',
  mHash: 'Hash — sha256 / sha512 streaming',
  mHashDesc: 'file or stdin',
  mPassword: 'Password — bcrypt hash / verify / generate',
  mPasswordDesc: '72-byte guard enforced',
  mJwt: 'JWT — decode token (read-only)',
  mJwtDesc: 'signature is never printed',
  mCsv: 'CSV — info / format / tojson',
  mCsvDesc: 'streaming RFC 4180 parser',
  mHttp: 'HTTP — requests with masked secrets',
  mHttpDesc: 'interactive mini-curl',
  mFree: 'Free mode — run any full jdev command',
  mFreeDesc: 'e.g. uuid --v7 --count 3',
  mLang: 'Language (es / en)',
  mLangDesc: 'switch the UI language',
  mLangMenu: 'Language — select',
  langSet: 'Language set: {lang}',
  tuiRequiresTty: 'tui requires an interactive terminal (TTY); use plain subcommands (jdev <cmd>) for scripts and automation',
  mQuit: 'Exit',
  freePrompt: 'Command (e.g. "uuid --v7 --count 3")',
  goodbye: 'Goodbye!',
  closing: 'Closing…',
  backToMain: '← Back to main menu',
  backPrompt: 'Press Enter to return to the main menu',
  moreLines: '… {n} more lines',
  askPath: 'Path of {what} (empty Enter to cancel)',
  notAFile: 'not a file',
  cannotRead: "could not read '{path}'",
  uuidVersion: 'UUID — version',
  uuidV4: 'v4 — random (RFC 4122)',
  uuidV7: 'v7 — time-ordered (RFC 9562)',
  uuidCount: 'Count (1–1000)',
  range1000: 'between 1 and 1000',
  jsonAction: 'JSON — action',
  jsonFormat: 'Format (pretty 2 spaces)',
  jsonMinify: 'Minify (one line)',
  jsonValidate: 'Validate (quiet → verdict)',
  jsonPath: 'JSON file',
  validJson: 'valid JSON',
  invalidJsonAt: 'invalid JSON at line {line}, column {column}',
  b64Action: 'Base64 — action',
  b64Encode: 'Encode (text → base64)',
  b64Decode: 'Decode (base64 → text)',
  b64Variant: 'Variant',
  b64Std: 'Standard (RFC 4648, with padding)',
  b64Url: 'URL-safe (JWT, no padding)',
  b64TextIn: 'Text to encode',
  b64StrIn: 'Base64 string',
  tsMode: 'Timestamp — mode',
  tsNow: 'Now (current clock)',
  tsConvert: 'Convert an epoch',
  tsUnit: 'Unit',
  tsSeconds: 'Seconds',
  tsMillis: 'Milliseconds',
  tsOut: 'Output',
  tsDigits: 'Epoch (number)',
  tsUtc: 'ISO 8601 UTC',
  tsLocal: 'ISO 8601 with local offset',
  tsInput: 'Epoch to convert',
  hashPath: 'file to hash',
  hashAlgo: 'Algorithm',
  pwAction: 'Password — action',
  pwGen: 'Generate random password',
  pwHash: 'Hash password (bcrypt)',
  pwVerify: 'Verify password',
  pwLen: 'Length (1–1024)',
  range1024: 'between 1 and 1024',
  pwPrompt: 'Password',
  pwEmpty: 'empty password',
  pwCost: 'Cost factor (4–31)',
  range431: 'between 4 and 31',
  pwVerifyPrompt: 'Password to verify',
  hashInput: 'bcrypt hash',
  pwMatch: 'password match',
  pwMalformed: 'malformed hash (expected $2a/$2b/$2y + cost + 53 chars)',
  pwMismatch: 'password mismatch',
  secretNote: '(secrets are masked for safety; the command works with your values)',
  jwtToken: 'JWT token',
  jwtHeader: 'JWT — header',
  jwtPayload: 'JWT — payload',
  jwtSigNote: '(signature is not decoded by design)',
  csvAction: 'CSV — action',
  csvInfo: 'Info (rows / columns)',
  csvFormat: 'Format (normalize RFC 4180)',
  csvToJson: 'Convert to JSON',
  csvPath: 'CSV file',
  httpUrl: 'URL (http://…)',
  httpUrlBad: 'invalid URL: must start with http:// or https://',
  httpMethod: 'Method',
  httpBody: 'Body (empty Enter for none)',
  httpHeader: 'Header {i} "Name: value" (empty Enter to finish)',
  httpHeaderBad: "ignored: missing ':' in '{h}'",
  httpTimeout: 'Timeout (seconds, 1–600)',
  range600: 'between 1 and 600',
  httpTls: 'Ignore TLS verification (--insecure)?',
  sending: 'sending…',
  masked: '***',
}

let current: Lang = detectSystemLang()

/** Resolve from (in order): flag → JDEV_LANG env → system locale → es. */
export function resolveLang(flag: string | undefined): Lang {
  const fromFlag = flag?.toLowerCase()
  if (fromFlag === 'es' || fromFlag === 'en') return fromFlag
  const fromEnv = process.env.JDEV_LANG?.toLowerCase()
  if (fromEnv === 'es' || fromEnv === 'en') return fromEnv
  return detectSystemLang()
}

function detectSystemLang(): Lang {
  const locale = process.env.LC_ALL ?? process.env.LC_MESSAGES ?? process.env.LANG ?? ''
  return locale.toLowerCase().startsWith('es') ? 'es' : 'en'
}

/** Render {@link current} lang string; missing/unknown keys resolve to Spanish. */
export function t(key: MsgKey, vars?: Record<string, string | number>): string {
  const table = current === 'en' ? en : es
  let s: string = table[key] ?? es[key]
  if (vars !== undefined) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  }
  return s
}

export function setLang(lang: Lang): void {
  current = lang
}

export function getLang(): Lang {
  return current
}