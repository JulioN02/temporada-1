import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Command } from 'commander'
import { JdevError, UsageError } from '../core/errors.ts'
import { readInput, resolveInput } from '../utils/io.ts'
import { stdoutData } from '../utils/output.ts'
import { installExitOverride, mapErrorToExit } from './exit.ts'

/** Wrap an action so thrown errors flow through mapErrorToExit (exit-code single source of truth). */
function guard<A extends unknown[]>(fn: (...args: A) => unknown): (...args: A) => Promise<void> {
  return (...args: A): Promise<void> =>
    Promise.resolve(fn(...args))
      .then(() => undefined)
      .catch(mapErrorToExit)
}

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

  // --- uuid: v4 for now; --v7 and --count land with the uuid module ---
  program
    .command('uuid')
    .description('generate UUIDs (v4, or v7 with --v7)')
    .action(guard(() => {
      stdoutData(`${randomUUID()}\n`)
    }))

  // --- json: minimal format/minify/validate until the json module lands ---
  program
    .command('json')
    .description('format, minify or validate JSON from a file or stdin')
    .argument('<action>', 'format, minify or validate')
    .argument('[file]', 'input file (or - for stdin)')
    .option('-i, --input <file>', 'input file (or - for stdin)')
    .action(guard(async (action: string, file: string | undefined, opts: { input?: string }) => {
      if (action !== 'format' && action !== 'minify' && action !== 'validate') {
        throw new UsageError(`unknown json action '${action}' (expected format, minify or validate)`, 'UNKNOWN_ACTION')
      }
      const text = (await readInput(resolveInput(file, opts.input))).toString('utf8')
      let value: unknown
      try {
        value = JSON.parse(text)
      } catch {
        throw new JdevError('INVALID_JSON', 'invalid JSON input')
      }
      if (action === 'format') stdoutData(`${JSON.stringify(value, null, 2)}\n`)
      else if (action === 'minify') stdoutData(`${JSON.stringify(value)}\n`)
      // validate: silent on success (script-friendly)
    }))

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
    ['base64', 'encode or decode base64 (RFC 4648, standard or URL-safe)'],
    ['timestamp', 'print the current Unix timestamp or convert an epoch'],
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