import type { Command } from 'commander'
import { JdevError, JsonParseError, UsageError } from '../core/errors.ts'
import { formatJson, minifyJson, validateJson } from '../core/json.ts'
import { readInput, resolveInput } from '../utils/io.ts'
import { stdoutData } from '../utils/output.ts'
import { t } from '../i18n.ts'
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
        if (!result.ok) {
          // Keep the JSON_PARSE exit-2 contract; the message follows --lang.
          throw new JdevError('INVALID_JSON', t('invalidJsonAt', { line: result.line, column: result.column }))
        }
        // Explicit confirmation: a silent success felt like nothing happened
        // interactively; exit 0 still makes this safe for script gates.
        stdoutData(`${t('validJson')}\n`)
        return
      }
      try {
        const out = action === 'format' ? formatJson(text) : minifyJson(text)
        stdoutData(`${out}\n`)
      } catch (err) {
        // Same localization as validate: INVALID_JSON keeps its exit-2 contract,
        // the message follows --lang for ALL json actions (not only validate).
        if (err instanceof JsonParseError) {
          throw new JdevError('INVALID_JSON', t('invalidJsonAt', { line: err.position.line, column: err.position.column }))
        }
        throw err
      }
    }))
}