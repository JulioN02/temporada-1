/**
 * Route — the handler chain of one path+method layer (design §4).
 * dispatch runs handlers FIFO; `next` is the local flow-control primitive:
 *   - next()          → next handler in the chain, then done() when exhausted
 *   - next('route')   → skip remaining handlers of THIS route, continue at the
 *                       next layer of the router stack (R12-S1)
 *   - next(err)       → propagate to the router (error mode)
 *   - next('router')  → abandon the whole router (O2/R12-S2), surfaces via done
 */

import type { AppRequest } from './request.ts';
import type { AppResponse } from './response.ts';
import type { DoneFunction, Handler } from './types.ts';

export class Route {
  readonly path: string;
  readonly handlers: Handler[] = [];

  constructor(path: string) {
    this.path = path;
  }

  dispatch(req: AppRequest, res: AppResponse, done: DoneFunction): void {
    let idx = 0;
    const next = (err?: unknown): void => {
      if (err === 'route') {
        done();
        return;
      }
      if (err !== undefined) {
        done(err); // includes the 'router' sentinel
        return;
      }
      if (idx >= this.handlers.length) {
        done();
        return;
      }
      const handler = this.handlers[idx++]!;
      handler(req, res, next);
    };
    next();
  }
}