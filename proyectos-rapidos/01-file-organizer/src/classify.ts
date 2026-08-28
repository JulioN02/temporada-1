/**
 * Pure extension classification (R1): derives a category exclusively from the
 * file name and the active mapping. No I/O, no global state — same input,
 * same output. Isolated so a future MIME-based classifier can replace it.
 */
import { basename } from 'node:path';
import type { Mapping } from './config.ts';

export type Classification =
  | { kind: 'category'; category: string }
  | { kind: 'misc' }
  | { kind: 'skip' }; // only when omitMisc=true (R5)

/**
 * Returns the lowercase extension of a file name, or null when there is no
 * extension (no dot, or a leading dot = dotfile). Only the last extension is
 * considered (`archive.tar.gz` → `gz`).
 */
export function extractExtension(filename: string): string | null {
  const base = basename(filename);
  const idx = base.lastIndexOf('.');
  if (idx <= 0) return null;
  return base.slice(idx + 1).toLowerCase();
}

export function classify(filename: string, mapping: Mapping, omitMisc = false): Classification {
  const ext = extractExtension(filename);
  if (ext === null || mapping[ext] === undefined) {
    return omitMisc ? { kind: 'skip' } : { kind: 'misc' };
  }
  return { kind: 'category', category: mapping[ext] };
}