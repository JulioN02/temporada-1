/**
 * Errors & finalhandler (design §8, §10).
 * HttpError carries a status; finalhandler maps the terminal state of a
 * dispatch: no error → 404, HttpError → its status+message, anything else
 * → 500 with a generic body (raw message never exposed, R7-S2).
 */

import type { AppRequest } from './request.ts';
import type { AppResponse } from './response.ts';

export const STATUS_MESSAGES = {
  400: 'Bad Request',
  404: 'Not Found',
  413: 'Payload Too Large',
  500: 'Internal Server Error',
} as const;

function messageFor(status: number): string {
  return STATUS_MESSAGES[status as keyof typeof STATUS_MESSAGES] ?? 'Error';
}

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message?: string) {
    super(message ?? messageFor(status));
    this.name = 'HttpError';
    this.status = status;
  }
}

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError;
}

/** Terminal responder: 404 / HttpError.status+message / 500 generic. */
export function finalhandler(err: unknown, _req: AppRequest, res: AppResponse): void {
  // Defensive guard (beyond design §4's dispatch contract; documented in
  // apply-progress, S-4): a handler may already have ended the response —
  // short-circuit without next() (R4-S3) or a double-response — so writing
  // again here would corrupt the wire format. headersSent || writableEnded
  // covers both partial and complete writes; bail out silently.
  if (res.headersSent || res.writableEnded) return;

  let status = 404;
  let body = messageFor(404);
  if (err !== undefined) {
    if (isHttpError(err)) {
      status = err.status;
      body = err.message;
    } else {
      status = 500;
      body = messageFor(500);
    }
  }

  res.statusCode = status;
  if (res.getHeader('Content-Type') === undefined) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  }
  res.end(body);
}