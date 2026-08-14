import { readFileSync } from 'node:fs'
import { Command } from 'commander'
import { UsageError } from '../core/errors.ts'
import { readInput, resolveInput } from '../utils/io.ts'
import { stdoutData } from '../utils/output.ts'
import { guard, installExitOverride } from './exit.ts'
import { register as registerBase64 } from './base64.ts'
import { register as registerJson } from './json.ts'
import { register as registerTimestamp } from './timestamp.ts'
import { register as registerUuid } from './uuid.ts'

/** Runtime version read from the package root (works from src/ AND dist/ in the tarball). */
function readVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version?: string
  }
  return pkg.version ?? '0.0.0'
}

/**
 * Build the `jdev` program registering all 9 subcommands.
 * Commands whose dedicated module has not landed yet keep a minimal
 * placeholder surface (help listing, io/exit contracts) and report
 * NOT_IMPLEMENTED (exit 1) on invocation.
 */
export function buildProgram(): Command {
  const program = new Command()
  program
    .name('jdev')
    .description('Professional CLI dev toolkit (uuid, json, base64, timestamp, hash, password, jwt, csv, http)')
    .version(readVersion(), '-V, --version', 'output the version number')

  registerUuid(program)
  registerJson(program)
  registerBase64(program)
  registerTimestamp(program)

  // --- hash: io contract only (missing file → exit 2); streaming sha256 lands later ---
  program
    .command('hash')
    .description('print the SHA-256 digest of a file or stdin')
    .argument('[file]', 'input file (or - for stdin)')
    .option('-i, --input <file>', 'input file (or - for stdin)')
    .option('--file <file>', 'alias for --input (spec scenario compatibility)')
    .action(guard(async (file: string | undefined, opts: { input?: string; file?: string }) => {
      const target = resolveInput(file, opts.file ?? opts.input)
      await readInput(target)
      throw new UsageError("'jdev hash' is not implemented yet", 'NOT_IMPLEMENTED')
    }))

  // --- jwt: required <token> argument (usage error → exit 1); decode lands later ---
  program
    .command('jwt')
    .description('decode a JWT token (header + payload, never the signature)')
    .argument('<token>', 'JWT token to decode')
    .action(guard(() => {
      throw new UsageError("'jdev jwt' is not implemented yet", 'NOT_IMPLEMENTED')
    }))

  // --- remaining subcommands: registered now so help lists all 9 ---
  const placeholders: ReadonlyArray<readonly [string, string]> = [
    ['password', 'hash, verify or generate passwords (bcrypt)'],
    ['csv', 'inspect, format or convert CSV (RFC 4180)'],
    ['http', 'issue an HTTP request (mini-curl)'],
  ]
  for (const [name, description] of placeholders) {
    program
      .command(name)
      .description(description)
      .action(guard(() => {
        throw new UsageError(`'jdev ${name}' is not implemented yet`, 'NOT_IMPLEMENTED')
      }))
  }

  // `jdev` with no arguments: print help to stdout, exit 0 (spec: help lists all 9 subcommands).
  program.action(() => {
    program.outputHelp()
  })

  installExitOverride(program)
  return program
}