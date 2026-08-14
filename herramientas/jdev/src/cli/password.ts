import type { Command } from 'commander'
import { generatePassword, hashPassword, verifyPassword } from '../core/password.ts'
import { JdevError, UsageError } from '../core/errors.ts'
import { stdoutData } from '../utils/output.ts'
import { guard } from './exit.ts'

function parseCost(raw: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 4 || n > 31) {
    throw new UsageError(`invalid --cost '${raw}' (expected an integer between 4 and 31)`, 'INVALID_COST')
  }
  return n
}

function parseLength(raw: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 1024) {
    throw new UsageError(`invalid --length '${raw}' (expected an integer between 1 and 1024)`, 'INVALID_LENGTH')
  }
  return n
}

/** Register the `password` subcommand: bcrypt hash/verify + crypto generation. */
export function register(program: Command): void {
  program
    .command('password')
    .description('hash, verify or generate passwords (bcrypt, 72-byte limit enforced)')
    .argument('<action>', 'hash, verify or generate')
    .argument('[password]', 'plaintext password to hash or verify')
    .argument('[hash]', 'bcrypt hash to verify against')
    .option('--cost <n>', 'bcrypt cost factor (default 10)', '10')
    .option('--length <n>', 'generated password length (default 16)', '16')
    .action(guard((action: string, password: string | undefined, hash: string | undefined, opts: { cost?: string; length?: string }) => {
      if (action === 'hash') {
        if (password === undefined) {
          throw new UsageError('password hash requires a <password> argument', 'MISSING_PASSWORD')
        }
        stdoutData(`${hashPassword(password, parseCost(opts.cost ?? '10'))}\n`)
        return
      }
      if (action === 'verify') {
        if (password === undefined || hash === undefined) {
          throw new UsageError('password verify requires <password> and <hash> arguments', 'MISSING_VERIFY_ARGS')
        }
        const result = verifyPassword(password, hash)
        if (result.ok) {
          // Explicit confirmation: a silent exit-0 felt like "nothing happened".
          stdoutData('password match\n')
          return
        }
        if (result.malformed) {
          throw new JdevError(
            'INVALID_BCRYPT_HASH',
            'malformed bcrypt hash (expected $2a$/$2b$/$2y$ + 2-digit cost + 53-char tail)',
          )
        }
        // mismatch → exit 2 with an explicit (non-diagnostic) verdict; the
        // message reveals nothing about the hash or the password itself.
        stdoutData('password mismatch\n')
        process.exitCode = 2
        return
      }
      if (action === 'generate') {
        stdoutData(`${generatePassword(parseLength(opts.length ?? '16'))}\n`)
        return
      }
      throw new UsageError(`unknown password action '${action}' (expected hash, verify or generate)`, 'UNKNOWN_ACTION')
    }))
}
