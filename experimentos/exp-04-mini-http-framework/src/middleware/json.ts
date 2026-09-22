/**
 * json() body parser (design §5, micro-contract 3).
 * Parses application/json bodies (media-type match, charset suffix allowed)
 * into req.body. Contract:
 *   - req.body !== undefined → next() (re-read guard, AD-5): a previous parser
 *     already populated the body; do NOT re-read the stream.
 *   - Content-Type mismatch → next(): req.body stays untouched (undefined).
 *   - Empty body with matching Content-Type → req.body = {} (R8-S3).
 *   - Malformed JSON → next(HttpError(400, 'Invalid JSON')) (R8-S2).
 *   - Body over BODY_LIMIT (configurable via {limit}) → next(HttpError(413)).
 * The stream read is async (AD-4/AD-7) — this is why makeRequest awaits.
 */

import { HttpError } from '../errors.ts';
import { contentTypeMatches } from '../request.ts';
import { readBody } from './readBody.ts';

import type { AppRequest } from '../request.ts';
import type { AppResponse } from '../response.ts';
import type { Handler, NextFunction } from '../types.ts';

/** Default body size limit: 100kb (body-parser default; design §8). */
export const BODY_LIMIT = 100 * 1024;

export interface JsonOptions {
  /** Maximum accepted body size in bytes (default BODY_LIMIT = 100kb). */
  limit?: number;
}

export function json(options?: JsonOptions): Handler {
  const limit = options?.limit ?? BODY_LIMIT;

  return async (req: AppRequest, res: AppResponse, next: NextFunction): Promise<void> => {
    if (req.body !== undefined) {
      next();
      return;
    }
    if (!contentTypeMatches(req.headers, 'application/json')) {
      next();
      return;
    }

    let raw: string;
    try {
      raw = await readBody(req, limit);
    } catch (err) {
      next(err); // HttpError(413) when the body exceeds the limit
      return;
    }

    if (raw.length === 0) {
      req.body = {}; // R8-S3: empty body with matching Content-Type → {}
      next();
      return;
    }
    try {
      req.body = JSON.parse(raw) as unknown;
    } catch {
      next(new HttpError(400, 'Invalid JSON'));
      return;
    }
    next();
  };
}