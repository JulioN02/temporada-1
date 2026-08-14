import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { Readable } from 'node:stream'
import { IoError, UsageError } from '../core/errors.ts'

/**
 * Resolve the effective input source: a positional file OR an -i/--input value.
 * Giving both is ambiguous → UsageError (exit 1). `-` means stdin.
 */
export function resolveInput(file: string | undefined, optInput: string | undefined): string | undefined {
  if (file !== undefined && optInput !== undefined) {
    throw new UsageError('ambiguous input: provide either a positional file or -i/--input, not both', 'AMBIGUOUS_INPUT')
  }
  return file ?? optInput
}

/** Buffered read of a file-or-stdin payload (json, base64). */
export async function readInput(file: string | undefined): Promise<Buffer> {
  if (file !== undefined && file !== '-') {
    try {
      return await readFile(file)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      throw new IoError(`cannot read file '${file}': ${reason}`)
    }
  }
  if (file === undefined && process.stdin.isTTY) {
    throw new UsageError('missing input: provide a file argument or pipe data on stdin', 'MISSING_INPUT')
  }
  return readStreamFully(process.stdin)
}

/** Streaming open of a file-or-stdin source (hash, csv). */
export function openInput(file: string | undefined): Readable {
  if (file === undefined && process.stdin.isTTY) {
    throw new UsageError('missing input: provide a file argument or pipe data on stdin', 'MISSING_INPUT')
  }
  if (file !== undefined && file !== '-') {
    return createReadStream(file)
  }
  return process.stdin
}

async function readStreamFully(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
