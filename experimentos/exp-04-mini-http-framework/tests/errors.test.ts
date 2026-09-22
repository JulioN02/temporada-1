import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { IncomingMessage, ServerResponse } from 'node:http';

import express from '../src/app.ts';
import { HttpError } from '../src/errors.ts';
import type { ErrorHandler } from '../src/types.ts';
import { FakeRequest, FakeResponse, makeRequest } from './helpers.ts';

// R5: error propagation — next(err) switches to error mode; normal layers are
// skipped; the next 4-arity middleware runs; error middlewares may chain via
// next(err). Detection is arity: fn.length === 4 (D4).

test('R5-S1: next(err) skips normal layers', async () => {
  const app = express();
  const order: string[] = [];
  const boom = new Error('boom');
  app.use((_req, _res, next) => { order.push('m1'); next(); });
  app.get('/x', (_req, _res, next) => { order.push('h'); next(boom); });
  app.use((_req, _res, next) => { order.push('m2'); next(); }); // 2-arity → must be skipped
  const errMw: ErrorHandler = (err, _req, res, _next) => {
    order.push(`errMw:${(err as Error).message}`);
    res.end('caught');
  };
  app.use(errMw);

  const res = await makeRequest(app, { method: 'GET', url: '/x' });
  assert.deepEqual(order, ['m1', 'h', 'errMw:boom']);
  assert.equal(res.statusCode, 200);
  assert.equal(res.bodyText, 'caught');
});

test('R5-S2: error chain via next(err)', async () => {
  const app = express();
  const order: string[] = [];
  const x = new Error('x');
  app.get('/x', (_req, _res, next) => { next(x); });
  const e1: ErrorHandler = (err, _req, _res, next) => { order.push(`e1:${(err as Error).message}`); next(err); };
  const e2: ErrorHandler = (_err, _req, res, _next) => { order.push('e2'); res.status(500).end('from-e2'); };
  app.use(e1);
  app.use(e2);

  const res = await makeRequest(app, { method: 'GET', url: '/x' });
  assert.deepEqual(order, ['e1:x', 'e2']);
  assert.equal(res.statusCode, 500);
  assert.equal(res.bodyText, 'from-e2');
});

// R6: 404 fallback — stack exhausted without a response → 404 plain text;
// method mismatch on a matching path is ALSO 404 (O1, faithful to Express).

test('R6-S1: unknown path', async () => {
  const app = express();
  app.get('/x', (_req, res, _next) => { res.end('x'); });

  const res = await makeRequest(app, { method: 'GET', url: '/nope' });
  assert.equal(res.statusCode, 404);
  assert.equal(res.bodyText, 'Not Found');
  assert.equal(res.getHeader('Content-Type'), 'text/plain; charset=utf-8');
});

test('R6-S2: method mismatch -> 404 (O1)', async () => {
  const app = express();
  app.get('/x', (_req, res, _next) => { res.end('x'); });

  const res = await makeRequest(app, { method: 'POST', url: '/x' });
  assert.equal(res.statusCode, 404, 'NOT 405');
  assert.equal(res.bodyText, 'Not Found');
});

test('R6-S3: HEAD to GET-only route -> 404 (micro-contract 10, user decision #5)', async () => {
  const app = express();
  let handlerRan = false;
  app.get('/x', (_req, res, _next) => { handlerRan = true; res.end('x'); });

  // HEAD is not special-cased: it is outside HTTP_METHODS, so a GET-only route
  // sees a method mismatch — same 404 mechanism as R6-S2 (never a 405).
  const res = await makeRequest(app, { method: 'HEAD', url: '/x' });
  assert.equal(res.statusCode, 404, 'HEAD is NOT special-cased -> method mismatch 404');
  assert.equal(res.bodyText, 'Not Found');
  assert.equal(handlerRan, false, 'GET handler must NOT run for a HEAD request');
});

// R7: HttpError vs generic error at the end of the stack.

test('R7-S1: HttpError maps status + message', async () => {
  const app = express();
  app.get('/x', (_req, _res, next) => { next(new HttpError(400, 'bad input')); });

  const res = await makeRequest(app, { method: 'GET', url: '/x' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.bodyText, 'bad input');
});

test('R7-S2: plain error -> 500', async () => {
  const app = express();
  app.get('/x', (_req, _res, next) => { next(new Error('boom')); });

  const res = await makeRequest(app, { method: 'GET', url: '/x' });
  assert.equal(res.statusCode, 500);
  assert.equal(res.bodyText, 'Internal Server Error');
  assert.ok(!res.bodyText.includes('boom'), 'raw message must NOT be exposed');
});

// R14: async errors — explicit next(err) only. The framework MUST NOT
// auto-wrap rejected promises (user decision #4, faithful to Express 5).

test('R14-S1: async try/catch + next(err)', async () => {
  const app = express();
  const failing = async (): Promise<never> => { throw new Error('async-boom'); };
  app.get('/x', async (_req, _res, next) => {
    try {
      await failing();
    } catch (err) {
      next(err);
    }
  });
  const errMw: ErrorHandler = (err, _req, res, _next) => {
    res.status(500).end(`caught:${(err as Error).message}`);
  };
  app.use(errMw);

  const res = await makeRequest(app, { method: 'GET', url: '/x' });
  assert.equal(res.statusCode, 500);
  assert.equal(res.bodyText, 'caught:async-boom');
});

test('R14-S2: rejected promise NOT auto-wrapped', async (t) => {
  const app = express();
  const boom = new Error('boom');
  app.get('/x', async () => { throw boom; });

  // The framework must not catch the rejection itself. Temporarily replace the
  // test-runner's unhandledRejection listeners with our own capture so the
  // rejection surfaces here (as an unhandled rejection) instead of failing the
  // suite; restore the runner's listeners afterwards.
  const runnerListeners = process.listeners('unhandledRejection');
  process.removeAllListeners('unhandledRejection');
  let captured: unknown;
  const onUnhandled = (reason: unknown): void => { captured = reason; };
  process.on('unhandledRejection', onUnhandled);
  t.after(() => {
    process.removeListener('unhandledRejection', onUnhandled);
    for (const listener of runnerListeners) process.on('unhandledRejection', listener);
  });

  const req = new FakeRequest('GET', '/x');
  const res = new FakeResponse();
  app.handle(req as unknown as IncomingMessage, res as unknown as ServerResponse);

  // Give the rejection a chance to surface; the framework sends NOTHING.
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(captured, boom, 'rejection surfaces as unhandled');
  assert.equal(res.writableEnded, false, 'no automatic response');
  assert.equal(res.bodyText, '');
});