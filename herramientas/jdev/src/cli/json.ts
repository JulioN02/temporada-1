import type { Command } from 'commander'
import { UsageError } from '../core/errors.ts'
import { formatJson, jsonFailureToError, minifyJson, validateJson } from '../core/json.ts'
import { readInput, resolveInput } from '../utils/io.ts'
import { stdoutData } from '../utils/output.ts'
import { guard } from './exit.ts'

const ACTIONS = new Set(['format', 'minify', 'validate'])

/** Register the `json` subcommand: format/minify/validate over file-or-stdin. */
export function register(program: Command): void {
  program
    .command('json')
    .description('format, minify or validate JSON from a file or stdin')
    .argument('<action>', 'format, minify or validate')
    .argument('[file]', 'input file (or - for stdin)')
    .option('-i, --input <file>', 'input file (or - for stdin)')
    .action(guard(async (action: string, file: string | undefined, opts: { input?: string }) => {
      if (!ACTIONS.has(action)) {
        throw new UsageError(`unknown json action '${action}' (expected format, minify or validate)`, 'UNKNOWN_ACTION')
      }
      const text = (await readInput(resolveInput(file, opts.input))).toString('utf8')
      if (action === 'validate') {
        const result = validateJson(text)
        if (!result.ok) throw jsonFailureToError(result)
        return // silent on success (script-friendly)
      }
      const out = action === 'format' ? formatJson(text) : minifyJson(text)
      stdoutData(`${out}\n`)
    }))
}