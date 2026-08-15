import type { Command } from 'commander'
import { hashStream, isHashAlgorithm, type HashAlgorithm } from '../core/hash.ts'
import { IoError, JdevError, UsageError } from '../core/errors.ts'
import { openInput, resolveInput } from '../utils/io.ts'
import { stdoutData } from '../utils/output.ts'
import { guard } from './exit.ts'

function parseAlgorithm(raw: string | undefined): HashAlgorithm {
  if (raw === undefined) return 'sha256'
  if (!isHashAlgorithm(raw)) {
    throw new UsageError(`invalid --algorithm '${raw}' (expected sha256 or sha512)`, 'INVALID_ALGORITHM')
  }
  return raw
}

/** Register the `hash` subcommand: streaming sha256/sha512 over file-or-stdin. */
export function register(program: Command): void {
  program
    .command('hash')
    .description('print the SHA-256 (or SHA-512) digest of a file or stdin')
    .argument('[file]', 'input file (or - for stdin)')
    .option('-i, --input <file>', 'input file (or - for stdin)')
    .option('--file <file>', 'alias for --input (spec scenario compatibility)')
    .option('-a, --algorithm <alg>', 'digest algorithm: sha256 (default) or sha512')
    .option('--algo <alg>', 'alias for --algorithm')
    .action(guard(async (file: string | undefined, opts: { input?: string; file?: string; algorithm?: string; algo?: string }) => {
      const target = resolveInput(file, opts.file ?? opts.input)
      const algorithm = parseAlgorithm(opts.algorithm ?? opts.algo)
      let digest: string
      try {
        digest = await hashStream(openInput(target), algorithm)
      } catch (err) {
        if (err instanceof JdevError) throw err // decode-side failures pass through untouched
        const reason = err instanceof Error ? err.message : String(err)
        // createReadStream open failures (ENOENT etc.) surface here as raw errors.
        throw new IoError(
          target === undefined ? `cannot read stdin: ${reason}` : `cannot read file '${target}': ${reason}`,
        )
      }
      stdoutData(`${digest}\n`)
    }))
}