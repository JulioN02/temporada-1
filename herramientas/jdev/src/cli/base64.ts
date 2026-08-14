import type { Command } from 'commander'
import { decodeBase64, encodeBase64, type DecodeOptions, type EncodeOptions } from '../core/base64.ts'
import { UsageError } from '../core/errors.ts'
import { readInput, resolveInput } from '../utils/io.ts'
import { stdoutData } from '../utils/output.ts'
import { guard } from './exit.ts'

/** Commander gives `boolean | undefined`; exactOptionalPropertyTypes forbids explicit undefined. */
function encodeOpts(url: boolean | undefined, padding: boolean | undefined): EncodeOptions {
  return {
    ...(url === undefined ? {} : { url }),
    ...(padding === undefined ? {} : { padding }),
  }
}

function decodeOpts(url: boolean | undefined): DecodeOptions {
  return url === undefined ? {} : { url }
}

/** Register the `base64` subcommand: encode/decode, standard or URL-safe. */
export function register(program: Command): void {
  program
    .command('base64')
    .description('encode or decode base64 (RFC 4648, standard or URL-safe)')
    .argument('<action>', 'encode or decode')
    .argument('[file]', 'input file (or - for stdin)')
    .option('-i, --input <file>', 'input file (or - for stdin)')
    .option('--url', 'use the base64url alphabet')
    .option('-p, --padding', 'add "=" padding (encode only; url mode defaults to no padding)')
    .action(guard(async (action: string, file: string | undefined, opts: { input?: string; url?: boolean; padding?: boolean }) => {
      if (action !== 'encode' && action !== 'decode') {
        throw new UsageError(`unknown base64 action '${action}' (expected encode or decode)`, 'UNKNOWN_ACTION')
      }
      if (action === 'decode' && opts.padding) {
        throw new UsageError('--padding only applies to encode', 'PADDING_ON_ENCODE_ONLY')
      }
      const buf = await readInput(resolveInput(file, opts.input))
      if (action === 'encode') {
        stdoutData(`${encodeBase64(buf, encodeOpts(opts.url, opts.padding))}\n`)
      } else {
        // Binary-safe decode: raw bytes via writeStdout — verbatim in pipes,
        // with a visual newline added ONLY when stdout is a TTY (helper logic).
        stdoutData(decodeBase64(buf.toString('utf8'), decodeOpts(opts.url)))
      }
    }))
}