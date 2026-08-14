import type { Command } from 'commander'
import { epochMillis, epochSeconds, parseEpoch, toIsoLocal, toIsoUtc } from '../core/timestamp.ts'
import { UsageError } from '../core/errors.ts'
import { stdoutData } from '../utils/output.ts'
import { guard } from './exit.ts'

/** Register the `timestamp` subcommand: epoch digits or ISO, seconds or ms. */
export function register(program: Command): void {
  program
    .command('timestamp')
    .description('print the current Unix timestamp or convert an epoch')
    .argument('[epoch]', 'epoch to convert (seconds by default, milliseconds with --ms)')
    .option('--ms', 'use milliseconds')
    .option('--iso', 'print an ISO 8601 timestamp instead of digits')
    .option('--local', 'use the numeric local offset in ISO output (requires --iso)')
    .action(guard((epochArg: string | undefined, opts: { ms?: boolean; iso?: boolean; local?: boolean }) => {
      if (opts.local && !opts.iso) {
        throw new UsageError('--local requires --iso', 'LOCAL_WITHOUT_ISO')
      }
      if (opts.iso) {
        // A given epoch is interpreted in the output unit (seconds, or ms with --ms).
        const seconds = parseEpoch(epochArg ?? String(epochSeconds()))
        const ms = opts.ms ? seconds : seconds * 1000
        stdoutData(`${opts.local ? toIsoLocal(ms) : toIsoUtc(ms)}\n`)
        return
      }
      if (epochArg !== undefined) {
        stdoutData(`${parseEpoch(epochArg)}\n`) // already in the requested unit (seconds or ms)
        return
      }
      stdoutData(`${opts.ms ? epochMillis() : epochSeconds()}\n`)
    }))
}