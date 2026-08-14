import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Create a throwaway directory under the OS tmp dir. */
export async function makeTempDir(prefix = 'jdev-test-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

/** Write a file inside a temp dir; returns its absolute path. */
export async function writeTempFile(dir: string, name: string, content: string | Buffer): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, content)
  return path
}

/** Recursively remove a temp dir. */
export async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}
