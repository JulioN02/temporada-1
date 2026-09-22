/**
 * Shared test fixtures (design §7, AD-4/AD-7).
 * - FakeRequest: a REAL Readable stream so body parsers run the exact same
 *   code path as real HTTP (AD-4). Body is delivered via push(chunk)+push(null).
 * - FakeResponse: flat fake mirroring the ServerResponse surface the framework
 *   touches (statusCode, setHeader/getHeader, end → bodyText, writableEnded).
 * - makeRequest: in-memory dispatch through app.handle, ASYNC (AD-7): resolves
 *   when the response ends ('finish' event) or immediately if already ended.
 *   NOTE: tests for R14-S2 (rejection without response) must call app.handle
 *   directly — makeRequest would wait forever for an end that never comes.
 * - makeServer: real HTTP server wrapping app.handle (used by R15 e2e).
 *
 * `app` is typed structurally ({ handle(req, res) }) instead of importing
 * App from src/app.ts, so this file compiles before app.ts exists (G1 → G2).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

import type { Params, Query } from '../src/types.ts';

export interface DispatchTarget {
  handle(req: IncomingMessage, res: ServerResponse): void;
}

export interface MakeRequestOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
}

export class FakeRequest extends Readable {
  method: string;
  url: string;
  headers: Record<string, string>;
  params: Params = {};
  query: Query = {};
  body: unknown = undefined;
  baseUrl = '';
  originalUrl = '';

  constructor(method: string, url: string, headers: Record<string, string> = {}, body?: string | Buffer) {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers;
    if (body !== undefined) this.push(body);
    this.push(null);
  }

  override _read(): void {
    // Data was pushed eagerly in the constructor; nothing to produce on demand.
  }
}

export class FakeResponse extends EventEmitter {
  statusCode = 200;
  writableEnded = false;
  bodyText = '';
  private headersMap = new Map<string, string | number | readonly string[]>();

  get headersSent(): boolean {
    return this.writableEnded;
  }

  setHeader(field: string, value: string | number | readonly string[]): void {
    this.headersMap.set(field.toLowerCase(), value);
  }

  getHeader(field: string): string | number | readonly string[] | undefined {
    return this.headersMap.get(field.toLowerCase());
  }

  hasHeader(field: string): boolean {
    return this.headersMap.has(field.toLowerCase());
  }

  end(chunk?: unknown): this {
    if (chunk !== undefined && chunk !== null) {
      this.bodyText = typeof chunk === 'string' ? chunk : String(chunk);
    }
    this.writableEnded = true;
    this.emit('finish');
    return this;
  }

  write(_chunk: unknown): boolean {
    return true;
  }
}

/** In-memory dispatch (D8): returns the fake response once it has ended. */
export async function makeRequest(
  app: DispatchTarget,
  opts: MakeRequestOptions,
): Promise<FakeResponse> {
  const req = new FakeRequest(opts.method, opts.url, opts.headers ?? {}, opts.body);
  const res = new FakeResponse();
  app.handle(req as unknown as IncomingMessage, res as unknown as ServerResponse);
  if (!res.writableEnded) {
    await new Promise<void>((resolve) => res.once('finish', resolve));
  }
  return res;
}

/** Real HTTP server wrapping app.handle on an ephemeral port (R15). */
export function makeServer(app: DispatchTarget): Server {
  return createServer((req, res) => app.handle(req, res));
}