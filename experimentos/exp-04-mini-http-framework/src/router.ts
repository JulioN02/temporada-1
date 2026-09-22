/**
 * Router — a FIFO stack of Layers; the app IS a router (design §1/§4).
 * handle() walks the stack with a closure `next` (single flow-control
 * primitive). A layer whose handler is a Router is MOUNTED: the prefix is
 * stripped from req.url (query preserved), req.baseUrl is concatenated, and
 * url/baseUrl are restored when the child yields (R11/R12-S2).
 * Sentinel 'router' abandons this router (restore happens in the mount
 * callback of the parent); 'route' is consumed by Route.dispatch but a plain
 * middleware calling next('route') is normalized to continue (Express-faithful).
 */

import { Layer } from './layer.ts';
import { Route } from './route.ts';

import type { AppRequest } from './request.ts';
import type { AppResponse } from './response.ts';
import type {
  AnyMiddleware,
  DoneFunction,
  ErrorHandler,
  Handler,
  HttpMethod,
  NextFunction,
} from './types.ts';

export class Router {
  readonly stack: Layer[] = [];

  // Overloaded use() so inline arrows get contextual typing (see src/app.ts).
  use(fn: Handler): this;
  use(fn: ErrorHandler): this;
  use(fn: Router): this;
  use(path: string, fn: Handler): this;
  use(path: string, fn: ErrorHandler): this;
  use(path: string, fn: Router): this;
  use(pathOrFn: string | AnyMiddleware | Router, maybeFn?: AnyMiddleware | Router): this;
  use(pathOrFn: string | AnyMiddleware | Router, maybeFn?: AnyMiddleware | Router): this {
    if (typeof pathOrFn === 'string') {
      if (maybeFn === undefined) {
        throw new TypeError('router.use() requires a middleware function');
      }
      this.stack.push(new Layer(pathOrFn, undefined, maybeFn, false));
    } else {
      this.stack.push(new Layer('/', undefined, pathOrFn, false));
    }
    return this;
  }

  /** Register a route layer that matches ANY method (used by all()). */
  route(path: string): Route {
    return this.newRouteLayer(path, undefined);
  }

  all(path: string, ...handlers: Handler[]): this {
    const route = this.newRouteLayer(path, undefined);
    route.handlers.push(...handlers);
    return this;
  }

  get(path: string, ...handlers: Handler[]): this {
    const route = this.newRouteLayer(path, 'GET');
    route.handlers.push(...handlers);
    return this;
  }

  post(path: string, ...handlers: Handler[]): this {
    const route = this.newRouteLayer(path, 'POST');
    route.handlers.push(...handlers);
    return this;
  }

  put(path: string, ...handlers: Handler[]): this {
    const route = this.newRouteLayer(path, 'PUT');
    route.handlers.push(...handlers);
    return this;
  }

  patch(path: string, ...handlers: Handler[]): this {
    const route = this.newRouteLayer(path, 'PATCH');
    route.handlers.push(...handlers);
    return this;
  }

  delete(path: string, ...handlers: Handler[]): this {
    const route = this.newRouteLayer(path, 'DELETE');
    route.handlers.push(...handlers);
    return this;
  }

  handle(req: AppRequest, res: AppResponse, done: DoneFunction): void {
    const stack = this.stack;
    let idx = 0;
    let error: unknown;

    const next = (maybeErr?: unknown): void => {
      if (maybeErr === 'router') {
        // Abandon this router; the parent's mount callback restores url/baseUrl.
        done();
        return;
      }
      // next() clears a previous error (recovery); next('route') from a plain
      // middleware means "continue" (Express-faithful normalization).
      error = maybeErr !== undefined && maybeErr !== 'route' ? maybeErr : undefined;

      while (idx < stack.length) {
        const layer = stack[idx++]!;
        const pathname = (req.url ?? '/').split('?')[0] ?? '/';
        const matched = layer.match(pathname, req.method ?? '');
        if (matched === null) continue;
        if (error !== undefined && !layer.isErrorLayer()) continue;
        req.params = matched;

        if (layer.handler instanceof Router) {
          // Mount (AD-6): strip prefix, concat baseUrl, save/restore on yield.
          const url = req.url ?? '/';
          const originalUrl = url;
          const originalBaseUrl = req.baseUrl;
          const prefix = layer.path;
          let stripped = url.slice(prefix.length) || '/';
          if (stripped[0] !== '/') stripped = '/' + stripped;
          req.url = stripped;
          req.baseUrl = originalBaseUrl + prefix;
          layer.handler.handle(req, res, (err?: unknown) => {
            req.url = originalUrl;
            req.baseUrl = originalBaseUrl;
            next(err);
          });
          return;
        }

        if (error !== undefined) layer.handleError(error, req, res, next);
        else layer.handleRequest(req, res, next);
        return;
      }

      if (error !== undefined) done(error);
      else done();
    };

    next();
  }

  private newRouteLayer(path: string, method: HttpMethod | undefined): Route {
    const route = new Route(path);
    const layer = new Layer(
      path,
      method,
      (req: AppRequest, res: AppResponse, next: NextFunction) => {
        route.dispatch(req, res, next);
      },
      true,
    );
    this.stack.push(layer);
    return route;
  }
}