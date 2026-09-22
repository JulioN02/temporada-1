/**
 * app.ts — express() factory (AD-1 composition).
 * The App DELEGATES to a private Router: same FIFO layer stack, so "the app
 * IS a router". handle() is the public in-memory dispatch surface (D8):
 * populates request state (params/query eager/body/baseUrl/originalUrl, D5/O3),
 * attaches response helpers (AD-2) and wires the finalhandler as `done`.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { finalhandler } from './errors.ts';
import { parseQuery } from './request.ts';
import { augmentResponse } from './response.ts';
import { Router } from './router.ts';

import type { AppRequest } from './request.ts';
import type { AppResponse } from './response.ts';
import type { AnyMiddleware, ErrorHandler, Handler } from './types.ts';

export interface App {
  // Overloaded use() so inline arrows get contextual typing (a single union
  // parameter type cannot contextually type an untyped arrow — same approach
  // as Express typings). The implementation signature stays a broad union.
  use(fn: Handler): App;
  use(fn: ErrorHandler): App;
  use(fn: Router): App;
  use(path: string, fn: Handler): App;
  use(path: string, fn: ErrorHandler): App;
  use(path: string, fn: Router): App;
  use(pathOrFn: string | AnyMiddleware | Router, maybeFn?: AnyMiddleware | Router): App;
  get(path: string, ...handlers: Handler[]): App;
  post(path: string, ...handlers: Handler[]): App;
  put(path: string, ...handlers: Handler[]): App;
  patch(path: string, ...handlers: Handler[]): App;
  delete(path: string, ...handlers: Handler[]): App;
  all(path: string, ...handlers: Handler[]): App;
  listen(port?: number, cb?: () => void): Server;
  handle(req: IncomingMessage, res: ServerResponse): void;
}

export default function express(): App {
  const router = new Router();

  const app: App = {
    use: (pathOrFn: string | AnyMiddleware | Router, maybeFn?: AnyMiddleware | Router): App => {
      router.use(pathOrFn, maybeFn);
      return app;
    },
    get: (path, ...handlers) => {
      router.get(path, ...handlers);
      return app;
    },
    post: (path, ...handlers) => {
      router.post(path, ...handlers);
      return app;
    },
    put: (path, ...handlers) => {
      router.put(path, ...handlers);
      return app;
    },
    patch: (path, ...handlers) => {
      router.patch(path, ...handlers);
      return app;
    },
    delete: (path, ...handlers) => {
      router.delete(path, ...handlers);
      return app;
    },
    all: (path, ...handlers) => {
      router.all(path, ...handlers);
      return app;
    },
    listen: (port, cb) => {
      return createServer((req, res) => app.handle(req, res)).listen(port, cb);
    },
    handle: (req, res) => {
      const aReq = req as AppRequest;
      // Populate request state ONCE per dispatch (R10 eager, O3, D5).
      aReq.params = {};
      aReq.query = parseQuery(aReq.url ?? '/');
      aReq.body = undefined;
      aReq.baseUrl = '';
      aReq.originalUrl = aReq.url ?? '/';

      const aRes = augmentResponse(res);
      router.handle(aReq, aRes, (err?: unknown) => {
        finalhandler(err, aReq, aRes);
      });
    },
  };

  return app;
}