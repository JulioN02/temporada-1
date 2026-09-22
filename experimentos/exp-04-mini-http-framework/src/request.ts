/**
 * AppRequest — the request shape every handler sees (design D7).
 * Extends IncomingMessage so the exact same object flows through real HTTP
 * (makeServer) and in-memory fakes (makeRequest, AD-4).
 *
 * parseQuery: 'simple' eager query parsing via node:querystring (D5).
 * contentTypeMatches: media-type match with optional `;charset=` suffix.
 */

import type { IncomingMessage } from 'node:http';
import { parse } from 'node:querystring';

import type { Params, Query } from './types.ts';

export interface AppRequest extends IncomingMessage {
  /** {} on entry; overwritten by the route layer that matches (design §4). */
  params: Params;
  /** Eager, populated once in app.handle — never a lazy getter (D5). */
  query: Query;
  /** undefined until a body parser matches (micro-contract 3); field always present. */
  body: unknown;
  /** '' at the top level; concatenated across nested mounts (R11). */
  baseUrl: string;
  /** Full original URL (path + query), NEVER mutated (O3). */
  originalUrl: string;
}

/** Parse the query string of a raw URL (path + query) into a flat object. */
export function parseQuery(url: string): Query {
  const queryString = url.split('?')[1];
  if (queryString === undefined) return {};
  // Spread normalizes the null-prototype object returned by querystring.parse
  // into a plain object ({} on empty — R10-S3 — has Object.prototype too).
  // The cast drops the undefined that NodeJS.Dict types add (querystring.parse
  // never yields undefined values at runtime).
  return { ...parse(queryString) } as Query;
}

/** True when the request's Content-Type main type equals `expected` (charset suffix allowed). */
export function contentTypeMatches(
  headers: IncomingMessage['headers'],
  expected: string,
): boolean {
  const header = headers['content-type'];
  if (header === undefined) return false;
  const mainType = (String(header).split(';')[0] ?? '').trim().toLowerCase();
  return mainType === expected.toLowerCase();
}