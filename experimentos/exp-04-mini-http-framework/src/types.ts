/**
 * Core shared types for the mini HTTP framework (design §3).
 * Const-types pattern: the method list is a `const` array, the type is derived.
 */

import type { AppRequest } from './request.ts';
import type { AppResponse } from './response.ts';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Single flow-control primitive: next() / next(err) / next('route') / next('router'). */
export type NextFunction = (err?: unknown) => void;

export type Handler = (req: AppRequest, res: AppResponse, next: NextFunction) => void;

/** Error middleware — detected at runtime by arity (fn.length === 4, D4). */
export type ErrorHandler = (err: unknown, req: AppRequest, res: AppResponse, next: NextFunction) => void;

export type AnyMiddleware = Handler | ErrorHandler;

/** Callback that ends a router's dispatch (finalhandler at the top level). */
export type DoneFunction = (err?: unknown) => void;

export type Params = Record<string, string>;

export type Query = Record<string, string | string[]>;