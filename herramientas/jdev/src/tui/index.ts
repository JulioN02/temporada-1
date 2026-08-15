import { input } from '@inquirer/prompts'
import type { Command } from 'commander'
import { UsageError } from '../core/errors.ts'
import { menuSelect } from './menu.ts'
import { BACK, backToMenu, base64Menu, BOLD, csvMenu, DIM, GREEN, hashMenu, httpMenu, jsonMenu, jwtMenu, passwordMenu, RESET, timestampMenu, uuidMenu } from './modules.ts'
import { getLang, setLang, t } from '../i18n.ts'

function title(): string {
  return `${BOLD}⚡ jdev${RESET} ${DIM}— ${t('titleTail')}${RESET}`
}

/**
 * Registers the `tui` subcommand on the shared commander program. The
 * full `jdev <cmd>` syntax remains the scripting surface; `tui` is purely
 * interactive. The language is resolved by the registry preAction hook
 * (--lang flag / JDEV_LANG / system locale).
 */
export function registerTui(program: Command): void {
  program
    .command('tui')
    .description('interactive TUI menu (requires a TTY)')
    .action(() => runTui())
}

/**
 * Inquirer signals an interactive abort (Ctrl+C / Ctrl+D / stdin close) by
 * rejecting with ExitPromptError. We want a graceful exit, not a stack trace.
 */
function isExitPromptError(err: unknown): boolean {
  return err instanceof Error && err.name === 'ExitPromptError'
}

/**
 * Entry for the `tui` subcommand: a guided, keyboard-driven menu over the SAME
 * core logic the plain CLI uses. Plain subcommands stay untouched (scripting /
 * pipe discipline); this surface is for humans.
 */
export async function runTui(): Promise<void> {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    throw new UsageError(
      'tui requires an interactive terminal (TTY); use plain subcommands (jdev <cmd>) for scripts and automation',
      'TUI_REQUIRES_TTY',
    )
  }

  process.stdout.write(`\n${title()}\n\n`)

  try {
    await tuiLoop()
  } catch (err) {
    if (isExitPromptError(err)) {
      process.stdout.write(`\n${DIM}${t('closing')}${RESET}\n`)
      process.exitCode = 0
      return
    }
    throw err
  }
}

async function tuiLoop(): Promise<void> {
  while (true) {
    const choice = await menuSelect({
      message: t('mainMenu'),
      pageSize: 14,
      choices: [
        { name: t('mUuid'), value: 'uuid', description: t('mUuidDesc') },
        { name: t('mJson'), value: 'json', description: t('mJsonDesc') },
        { name: t('mBase64'), value: 'base64', description: t('mBase64Desc') },
        { name: t('mTimestamp'), value: 'timestamp', description: t('mTimestampDesc') },
        { name: t('mHash'), value: 'hash', description: t('mHashDesc') },
        { name: t('mPassword'), value: 'password', description: t('mPasswordDesc') },
        { name: t('mJwt'), value: 'jwt', description: t('mJwtDesc') },
        { name: t('mCsv'), value: 'csv', description: t('mCsvDesc') },
        { name: t('mHttp'), value: 'http', description: t('mHttpDesc') },
        { name: t('mFree'), value: 'free', description: t('mFreeDesc') },
        { name: t('mLang'), value: 'lang', description: t('mLangDesc') },
        { name: t('mQuit'), value: 'quit' },
      ],
    })

    if (choice === 'quit') {
      process.stdout.write(`${DIM}${t('goodbye')}${RESET}\n`)
      process.exitCode = 0
      return
    }

    // Run one module; true = user already navigated back (no extra prompt).
    let wentBack = false
    try {
      switch (choice) {
        case 'uuid': wentBack = await uuidMenu(); break
        case 'json': wentBack = await jsonMenu(); break
        case 'base64': wentBack = await base64Menu(); break
        case 'timestamp': wentBack = await timestampMenu(); break
        case 'hash': wentBack = await hashMenu(); break
        case 'password': wentBack = await passwordMenu(); break
        case 'jwt': wentBack = await jwtMenu(); break
        case 'csv': wentBack = await csvMenu(); break
        case 'http': wentBack = await httpMenu(); break
        case 'free': await freeCommandMode(); break
        case 'lang': wentBack = await langMenu(); break
        default: break
      }
    } catch (err) {
      if (isExitPromptError(err)) throw err
      process.stdout.write(`\n\x1b[31m✗ ${err instanceof Error ? err.message : String(err)}\x1b[0m\n`)
    }
    if (!wentBack) await backToMenu()
  }
}

/**
 * Language switcher: applied live — the next renders (and the reprinted
 * title) come out in the selected language. Returns true (no extra
 * "press enter" prompt): the user is already back at the main menu.
 */
async function langMenu(): Promise<boolean> {
  const current = getLang()
  const choice = await menuSelect({
    message: t('mLangMenu'),
    choices: [
      { name: 'Español (neutro)', value: 'es' },
      { name: 'English', value: 'en' },
      { name: t('backToMain'), value: BACK },
    ],
    default: current,
  })
  if (choice === BACK) return true
  if (choice !== current) {
    setLang(choice)
    const label = choice === 'es' ? 'Español' : 'English'
    process.stdout.write(`${GREEN}✓ ${t('langSet', { lang: label })}${RESET}\n`)
    process.stdout.write(`\n${title()}\n\n`)
  }
  return true
}

/**
 * Free mode: let the user type a full `jdev <subcommand> …` line and run it
 * through the real commander program (same code path as the plain binary).
 * process.exitCode is restored so the TUI loop can continue.
 */
async function freeCommandMode(): Promise<void> {
  const line = await input({ message: t('freePrompt') })
  const args = splitArgs(line)
  if (args.length === 0) return
  process.stdout.write(`\n${DIM}$ jdev ${args.join(' ')}${RESET}\n`)
  // Lazy dynamic import avoids a static import cycle with cli/registry.
  const { buildProgram } = await import('../cli/registry.ts')
  const before = process.exitCode
  try {
    await buildProgram().parseAsync(['node', 'jdev', ...args])
  } finally {
    process.exitCode = before
  }
}

/**
 * Minimal POSIX-ish tokenizer: space-separated, honoring single and double
 * quotes (no backslash escapes needed for our use).
 */
export function splitArgs(line: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3]!)
  }
  return out
}