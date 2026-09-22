/**
 * urlencoded() body parser (design §5, micro-contract 3).
 * Parses application/x-www-form-urlencoded bodies into a flat req.body with
 * node:querystring semantics (+ → space, percent-decoding, repeated keys →
 * array, R9-S1/R10 shared). Same re-read guard and size limit as json()
 * (BODY_LIMIT imported from json.ts, task 6.2); Content-Type mismatch passes
 * through leaving req.body untouched (undefined, R9-S2).
 */

import { parse as parseQueryString } from 'node:querystring';

import { BODY_LIMIT } from './json.ts';
import { readBody } from './readBody.ts';

import { contentTypeMatches } from '../request.ts';

import type { AppRequest } from '../request.ts';
import type { AppResponse } from '../response.ts';
import type { Handler, NextFunction } from '../types.ts';

export interface UrlencodedOptions {
  /** Maximum accepted body size in bytes (default BODY_LIMIT = 100kb). */
  limit?: number;
}

export function urlencoded(options?: UrlencodedOptions): Handler {
  const limit = options?.limit ?? BODY_LIMIT;

  return async (req: AppRequest, res: AppResponse, next: NextFunction): Promise<void> => {
    if (req.body !== undefined) {
      next(); // re-read guard (AD-5)
      return;
    }
    if (!contentTypeMatches(req.headers, 'application/x-www-form-urlencoded')) {
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

    // Spread normalizes the null-prototype object returned by querystring.parse
    // into a plain object (consistent with req.body = {} on empty body; also
    // required for deepStrictEqual comparisons in tests).
    req.body = { ...parseQueryString(raw) };
    next();
  };
}