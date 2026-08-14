import { StringDecoder } from 'node:string_decoder'
import { CsvError } from './errors.ts'

/** Parser states (RFC 4180 state machine). */
type CsvState = 'fieldStart' | 'inUnquoted' | 'inQuoted' | 'quoteInQuote' | 'cr'

/**
 * ONE char-wise CSV state machine — the only CSV parser in the codebase.
 *
 * - `,` ends a field; `"` (at field start OR mid-field, lenient) opens quoted mode
 * - `""` inside quotes = literal quote
 * - `\r` → CR state; `\n` after CR ends the record (CRLF normalized to LF)
 * - lone `\r` also ends a record (classic Mac); inside quotes `\r\n`/`\r` → `\n`
 * - BOM (U+FEFF) stripped at stream start (even if split across chunks)
 * - bare empty lines (no content between newlines) are SKIPPED — never records
 * - stray char after a closing quote → CsvError, row-named (strict)
 * - EOF inside quotes → CsvError 'unterminated quoted field at row N'
 * - final line without trailing newline counts as a record
 * - rows are yielded incrementally — memory is bounded by the largest row
 */
export async function* createParser(source: AsyncIterable<Buffer | string>): AsyncGenerator<string[]> {
  const decoder = new StringDecoder('utf8')
  let fields: string[] = []
  let field = ''
  let state: CsvState = 'fieldStart'
  let recordHasContent = false
  let inQuotedField = false
  let completedRecords = 0
  let atStreamStart = true
  // Records completed during a chunk's char scan; drained by the generator
  // right after the scan (keeps yield at generator level, memory = rows per chunk).
  const pending: string[][] = []

  const closeField = (): void => {
    fields.push(field)
    field = ''
  }

  const currentRow = (): number => completedRecords + 1

  /** Finalize the current record; bare empty lines are dropped, not records. */
  const emitRecord = (): void => {
    closeField()
    if (recordHasContent) {
      pending.push(fields)
      completedRecords++
    }
    fields = []
    state = 'fieldStart'
    recordHasContent = false
    inQuotedField = false
  }

  const scan = (text: string, final = false): void => {
    for (let i = 0; i < text.length; i++) {
      let ch = text[i]!
      if (atStreamStart) {
        atStreamStart = false
        if (ch === '\uFEFF') continue // strip BOM
      }
      // CR resolution may re-process the same char after a record end / quoted-\r.
      let reprocess = false
      do {
        reprocess = false
        switch (state) {
          case 'fieldStart':
            if (ch === ',') {
              closeField()
              recordHasContent = true
            } else if (ch === '"') {
              state = 'inQuoted'
              inQuotedField = true
              recordHasContent = true
            } else if (ch === '\r') {
              state = 'cr'
            } else if (ch === '\n') {
              emitRecord() // bare line (dropped) or trailing-comma row
            } else {
              field += ch
              state = 'inUnquoted'
              recordHasContent = true
            }
            break

          case 'inUnquoted':
            if (ch === ',') {
              closeField()
              state = 'fieldStart'
            } else if (ch === '"') {
              state = 'inQuoted'
              inQuotedField = true
            } else if (ch === '\r') {
              state = 'cr'
            } else if (ch === '\n') {
              emitRecord()
            } else {
              field += ch
            }
            break

          case 'inQuoted':
            if (ch === '"') {
              state = 'quoteInQuote'
            } else if (ch === '\r') {
              state = 'cr' // inQuotedField stays true: CR is field data
            } else if (ch === '\n') {
              field += '\n'
            } else {
              field += ch
            }
            break

          case 'quoteInQuote':
            if (ch === '"') {
              field += '"' // "" escape: literal quote, still quoted
              state = 'inQuoted'
            } else if (ch === ',') {
              closeField()
              state = 'fieldStart'
              inQuotedField = false
            } else if (ch === '\r') {
              state = 'cr'
              inQuotedField = false
            } else if (ch === '\n') {
              inQuotedField = false
              emitRecord()
            } else {
              throw new CsvError(`unexpected character after closing quote at row ${currentRow()}`)
            }
            break

          case 'cr':
            if (ch === '\n') {
              if (inQuotedField) {
                field += '\n' // CRLF inside quotes = one LF
                state = 'inQuoted'
              } else {
                emitRecord()
              }
            } else if (inQuotedField) {
              field += '\n' // lone \r inside quotes = LF
              state = 'inQuoted'
              reprocess = true
            } else {
              emitRecord() // lone \r = record end
              reprocess = true
            }
            break
        }
      } while (reprocess)
    }
    // Only IN-QUOTED is unterminated at EOF: a pending quoteInQuote means the
    // `"` was a CLOSING quote → the record ends normally in emitRecord() below.
    if (final && state === 'inQuoted') {
      throw new CsvError(`unterminated quoted field at row ${currentRow()}`)
    }
  }

  for await (const chunk of source) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8')
    scan(decoder.write(buf))
    while (pending.length > 0) yield pending.shift()!
  }
  // Flush decoder remnants, then final record / unterminated-quote verdict.
  scan(decoder.end(), true)
  emitRecord()
  while (pending.length > 0) yield pending.shift()!
}

/**
 * Count records: first non-empty record is the header; `rows` counts the rest.
 * Empty input → { rows: 0, columns: 0 }; header-only → { rows: 0, columns: N }.
 */
export async function csvInfo(
  source: AsyncIterable<Buffer | string>,
): Promise<{ rows: number; columns: number }> {
  let header: readonly string[] | undefined
  let rows = 0
  for await (const record of createParser(source)) {
    if (header === undefined) {
      header = record
    } else {
      rows++
    }
  }
  return { rows, columns: header?.length ?? 0 }
}

/** Re-emit normalized CSV: BOM gone, CRLF→LF, RFC 4180 re-quoting. */
export async function* formatCsv(source: AsyncIterable<Buffer | string>): AsyncGenerator<string> {
  for await (const record of createParser(source)) {
    yield `${record.map(formatField).join(',')}\n`
  }
}

function formatField(field: string): string {
  if (/[,"\n\r]/.test(field)) return `"${field.replace(/"/g, '""')}"`
  return field
}

/**
 * Stream a JSON array of objects keyed by the header row, one object per data
 * record, incrementally (`[`, rows, `]`). Memory independent of file size.
 */
export async function* csvToJson(source: AsyncIterable<Buffer | string>): AsyncGenerator<string> {
  let header: readonly string[] | undefined
  let first = true // no data record emitted yet → emit `[` with the first row
  for await (const record of createParser(source)) {
    if (header === undefined) {
      header = record
      continue
    }
    if (first) {
      yield '['
      first = false
    } else {
      yield ','
    }
    const obj: Record<string, string> = {}
    header.forEach((key, i) => {
      obj[key] = record[i] ?? ''
    })
    yield JSON.stringify(obj)
  }
  if (first) yield '[' // empty or header-only input → `[]`
  yield ']'
}