import type { Command } from 'commander'
import { decodeJwt } from '../core/jwt.ts'
import { stdoutData } from '../utils/output.ts'
import { guard } from './exit.ts'

/** Register the `jwt` subcommand: decode-only inspection (signature never printed). */
export function register(program: Command): void {
  program
    .command('jwt')
    .description('decode a JWT token (header + payload, never the signature)')
    .argument('<token>', 'JWT token to decode')
    // No --secret/--verify options exist by design — commander reports them as
    // unknown options (exit 1), proving the verify capability is absent.
    .action(guard((token: string) => {
      const { header, payload } = decodeJwt(token)
      stdoutData(`${JSON.stringify({ header, payload }, null, 2)}\n`)
    }))
}