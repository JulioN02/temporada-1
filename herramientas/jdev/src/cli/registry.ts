import { readFileSync } from 'node:fs'
import { Command, Option } from 'commander'
import { guard, installExitOverride } from './exit.ts'
import { register as registerBase64 } from './base64.ts'
import { register as registerCsv } from './csv.ts'
import { register as registerHash } from './hash.ts'
import { register as registerHttp } from './http.ts'
import { register as registerJson } from './json.ts'
import { register as registerJwt } from './jwt.ts'
import { register as registerPassword } from './password.ts'
import { register as registerTimestamp } from './timestamp.ts'
import { register as registerUuid } from './uuid.ts'
import { registerTui } from '../tui/index.ts'
import { resolveLang, setLang } from '../i18n.ts'

/** Runtime version read from the package root (works from src/ AND dist/ in the tarball). */
function readVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version?: string
  }
  return pkg.version ?? '0.0.0'
}

/** `--lang` option: valid anywhere (before or after the subcommand). */
function langOption(): Option {
  return new Option('--lang <lang>', 'language for messages: es | en (default: system locale; JDEV_LANG overrides)')
    .choices(['es', 'en'])
}

/**
 * Build the `jdev` program registering all 10 subcommands
 * (9 dedicated modules + the interactive TUI).
 */
export function buildProgram(): Command {
  const program = new Command()
  program
    .name('jdev')
    .description('Professional CLI dev toolkit (uuid, json, base64, timestamp, hash, password, jwt, csv, http, tui)')
    .version(readVersion(), '-V, --version', 'output the version number')
    .addOption(langOption())

  registerUuid(program)
  registerJson(program)
  registerBase64(program)
  registerTimestamp(program)
  registerHash(program)
  registerPassword(program)
  registerJwt(program)
  registerCsv(program)
  registerHttp(program)
  registerTui(program)

  // `--lang` must also parse after the subcommand (jdev uuid --lang es).
  for (const sub of program.commands) sub.addOption(langOption())

  // Resolve the UI/message language before any action runs.
  program.hook('preAction', (_thisCmd, actionCmd) => {
    setLang(resolveLang(actionCmd.optsWithGlobals().lang as string | undefined))
  })

  // `jdev` with no arguments: print help to stdout, exit 0 (spec: help lists all 10 subcommands).
  program.action(() => {
    program.outputHelp()
  })

  installExitOverride(program)
  return program
}