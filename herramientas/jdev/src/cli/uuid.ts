import type { Command } from 'commander'
import { UsageError } from '../core/errors.ts'
import { uuidV4, uuidV7 } from '../core/uuid.ts'
import { stdoutData } from '../utils/output.ts'
import { guard } from './exit.ts'

/** Register the `uuid` subcommand: v4 default, --v7 for RFC 9562, --count N. */
export function register(program: Command): void {
  program
    .command('uuid')
    .description('generate UUIDs (v4 by default, RFC 9562 v7 with --v7)')
    .option('--v4', 'generate a version 4 UUID (default)')
    .option('--v7', 'generate a version 7 (time-ordered) UUID')
    .option('--count <n>', 'number of UUIDs to generate (default 1)')
    .action(guard((opts: { v4?: boolean; v7?: boolean; count?: string }) => {
      if (opts.v4 && opts.v7) {
        throw new UsageError('--v4 and --v7 are mutually exclusive', 'MUTUALLY_EXCLUSIVE')
      }
      const count = parseCount(opts.count)
      const generate = opts.v7 ? uuidV7 : uuidV4
      for (let i = 0; i < count; i++) {
        stdoutData(`${generate()}\n`)
      }
    }))
}

function parseCount(raw: string | undefined): number {
  if (raw === undefined) return 1
  if (!/^\d+$/.test(raw)) {
    throw new UsageError(`invalid --count value '${raw}' (expected a positive integer)`, 'INVALID_COUNT')
  }
  const n = Number(raw)
  if (n < 1) {
    throw new UsageError('--count must be at least 1', 'INVALID_COUNT')
  }
  return n
}