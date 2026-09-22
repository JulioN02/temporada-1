/**
 * Shared stream reader for body parsers (design §5, task 6.3 REFACTOR).
 * Reads the request stream to a UTF-8 string, accumulating chunks and counting
 * bytes; when the accumulated size exceeds `limit` the read is aborted and the
 * promise rejects with HttpError(413) — the stream is destroyed so no more
 * data is consumed. Shared by json() and urlencoded() so both parsers run the
 * EXACT same code path as real HTTP (AD-4: FakeRequest is a real Readable).
 */

import { HttpError } from '../errors.ts';

import type { AppRequest } from '../request.ts';

export function readBody(req: AppRequest, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      total += chunk.length;
      if (total > limit) {
        aborted = true;
        req.destroy(); // stop consuming; the rest of the body is ignored
        reject(new HttpError(413, 'Payload Too Large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!aborted) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => reject(err));
  });
}