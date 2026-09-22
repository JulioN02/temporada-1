/**
 * Layer — one entry of the router stack (design §2/§4).
 * Compiles a path into a RegExp at construction:
 *   - `:name` segments become named capture groups `(?<name>[^/]+)` (one raw
 *     segment, never across '/'); everything else is regex-escaped.
 *   - end:true  (routes)  → `^pattern/?$`   (trailing slash non-strict)
 *   - end:false (middleware) → `^pattern(?=/|$)` (segment-boundary prefix);
 *     path '/' matches everything (global middleware).
 * Method is matched only when the layer carries one (O1: mismatch → no match,
 * which ends as 404). Param values are percent-decoded; a malformed escape
 * makes the layer NOT match (documented edge → 404).
 * Error middleware is detected by arity: fn.length === 4 (D4).
 * The Layer stores the handler but knows NOTHING about mounting (design: the
 * Router decides what to do with a Router handler via instanceof).
 */

import type { Router } from './router.ts'; // type-only: Layer knows nothing about mounting (design §2)
import type { AppRequest } from './request.ts';
import type { AppResponse } from './response.ts';
import type {
  AnyMiddleware,
  ErrorHandler,
  Handler,
  HttpMethod,
  NextFunction,
  Params,
} from './types.ts';

export type LayerHandler = AnyMiddleware | Router;

function escapeRegExp(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compilePath(
  path: string,
  end: boolean,
): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const body = path
    .split('/')
    .map((segment) => {
      if (segment === '') return '';
      if (segment.startsWith(':')) {
        const name = segment.slice(1);
        if (/^[A-Za-z0-9_]+$/.test(name)) {
          paramNames.push(name);
          return `(?<${name}>[^/]+)`;
        }
      }
      return escapeRegExp(segment);
    })
    .join('/');

  if (end) return { regex: new RegExp(`^${body}/?$`), paramNames };
  if (path === '/') return { regex: /^/, paramNames }; // global middleware
  return { regex: new RegExp(`^${body}(?=/|$)`), paramNames };
}

export class Layer {
  readonly path: string;
  readonly method: HttpMethod | undefined;
  readonly handler: LayerHandler;
  readonly end: boolean;
  readonly regex: RegExp;
  readonly paramNames: string[];

  constructor(path: string, method: HttpMethod | undefined, handler: LayerHandler, end = true) {
    this.path = path;
    this.method = method;
    this.handler = handler;
    this.end = end;
    const compiled = compilePath(path, end);
    this.regex = compiled.regex;
    this.paramNames = compiled.paramNames;
  }

  /** Error middleware detection via arity (D4); Router handlers are never error layers. */
  isErrorLayer(): boolean {
    return typeof this.handler === 'function' && (this.handler as AnyMiddleware).length === 4;
  }

  /** Returns captured params when path AND (if set) method match; null otherwise. */
  match(pathname: string, method: string): Params | null {
    if (this.method !== undefined && this.method !== method) return null;
    const matched = this.regex.exec(pathname);
    if (matched === null) return null;
    const params: Params = {};
    for (const name of this.paramNames) {
      const raw = matched.groups?.[name];
      if (raw !== undefined) {
        try {
          params[name] = decodeURIComponent(raw);
        } catch {
          return null; // malformed %-escape in a param → layer does not match
        }
      }
    }
    return params;
  }

  handleRequest(req: AppRequest, res: AppResponse, next: NextFunction): void {
    (this.handler as Handler)(req, res, next);
  }

  handleError(err: unknown, req: AppRequest, res: AppResponse, next: NextFunction): void {
    (this.handler as ErrorHandler)(err, req, res, next);
  }
}