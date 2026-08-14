import type { Command } from 'commander'
import { csvInfo, csvToJson, formatCsv } from '../core/csv.ts'
import { IoError, JdevError, UsageError } from '../core/errors.ts'
import { openInput, resolveInput } from '../utils/io.ts'
import { stdoutData } from '../utils/output.ts'
import { guard } from './exit.ts'

type CsvAction = 'info' | 'format' | 'tojson'

function parseAction(raw: string): CsvAction {
  if (raw === 'info' || raw === 'format' || raw === 'tojson') return raw
  throw new UsageError(`unknown csv action '${raw}' (expected info, format or tojson)`, 'UNKNOWN_ACTION')
}

/** Register the `csv` subcommand: streaming RFC 4180 inspect/format/convert. */
export function register(program: Command): void {
  program
    .command('csv')
    .description('inspect, format or convert CSV (RFC 4180 streaming parser)')
    .argument('<action>', 'info, format or tojson')
    .argument('[file]', 'input file (or - for stdin)')
    .option('-i, --input <file>', 'input file (or - for stdin)')
    .action(guard(async (action: string, file: string | undefined, opts: { input?: string }) => {
      const mode = parseAction(action)
      const source = openInput(resolveInput(file, opts.input))
      try {
        if (mode === 'info') {
          const { rows, columns } = await csvInfo(source)
          stdoutData(`rows: ${rows}\ncolumns: ${columns}\n`)
        } else if (mode === 'format') {
          for await (const line of formatCsv(source)) stdoutData(line)
        } else {
          for await (const chunk of csvToJson(source)) stdoutData(chunk)
        }
      } catch (err) {
        if (err instanceof JdevError) throw err // CsvError passes through untouched
        const reason = err instanceof Error ? err.message : String(err)
        // createReadStream open failures (ENOENT etc.) surface here as raw errors.
        throw new IoError(
          file === undefined ? `cannot read stdin: ${reason}` : `cannot read file '${file}': ${reason}`,
        )
      }
    }))
}