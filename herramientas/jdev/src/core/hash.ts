import { createHash } from 'node:crypto'

export type HashAlgorithm = 'sha256' | 'sha512'

const ALGORITHMS: ReadonlySet<string> = new Set(['sha256', 'sha512'])

/** Type guard for the supported digest algorithms. */
export function isHashAlgorithm(value: string): value is HashAlgorithm {
  return ALGORITHMS.has(value)
}

/**
 * Stream-hash an async source (file stream or stdin) with bounded memory.
 * Async iteration (NOT .pipe()) so stream errors surface as rejections.
 */
export async function hashStream(
  source: AsyncIterable<Buffer | string>,
  algorithm: HashAlgorithm = 'sha256',
): Promise<string> {
  const hash = createHash(algorithm)
  for await (const chunk of source) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}