/**
 * AppResponse — the response shape handlers use (design §6, AD-2).
 * The helpers are attached per request in app.handle (augmentResponse),
 * NOT via prototype magic: works on real ServerResponse and on the flat
 * FakeResponse used by tests.
 */

import type { ServerResponse } from 'node:http';

export interface AppResponse extends ServerResponse {
  /** Set the status code; chainable. */
  status(code: number): this;
  /** Set a header; chainable. */
  set(field: string, value: string | number | readonly string[]): this;
  /** Send JSON with application/json unless Content-Type was already set. */
  json(body: unknown): this;
  /** Minimal negotiation: string → text/plain; object → JSON; others → empty body. */
  send(body: unknown): this;
}

/** Attach status/set/json/send onto an existing ServerResponse (AD-2). */
export function augmentResponse(res: ServerResponse): AppResponse {
  const r = res as AppResponse;

  r.status = (code: number): AppResponse => {
    r.statusCode = code;
    return r;
  };

  r.set = (field: string, value: string | number | readonly string[]): AppResponse => {
    r.setHeader(field, value);
    return r;
  };

  r.json = (body: unknown): AppResponse => {
    if (r.getHeader('Content-Type') === undefined) {
      r.setHeader('Content-Type', 'application/json');
    }
    r.end(JSON.stringify(body));
    return r;
  };

  r.send = (body: unknown): AppResponse => {
    if (typeof body === 'string') {
      if (r.getHeader('Content-Type') === undefined) {
        r.setHeader('Content-Type', 'text/plain; charset=utf-8');
      }
      r.end(body);
    } else if (body !== null && typeof body === 'object' && !Buffer.isBuffer(body)) {
      r.json(body); // respects a pre-set Content-Type (R13-S2)
    } else {
      r.end(); // number/Buffer/other → out of scope (micro-contract 6), empty body
    }
    return r;
  };

  return r;
}