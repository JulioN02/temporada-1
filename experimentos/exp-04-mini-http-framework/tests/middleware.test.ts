import { test } from 'node:test';
import assert from 'node:assert/strict';

import express from '../src/app.ts';
import { Router } from '../src/router.ts';
import { makeRequest } from './helpers.ts';

// R4: middleware pipeline — app.use(fn) runs for every request; app.use('/p', fn)
// only on prefix match with segment boundary; layers run FIFO; a layer that
// responds without next() short-circuits the pipeline.

test('R4-S1: global middleware FIFO', async () => {
  const app = express();
  const order: string[] = [];
  app.use((_req, _res, next) => { order.push('m1'); next(); });
  app.use((_req, _res, next) => { order.push('m2'); next(); });
  app.get('/x', (_req, res, _next) => { order.push('h'); res.end('done'); });

  const res = await makeRequest(app, { method: 'GET', url: '/x' });
  assert.deepEqual(order, ['m1', 'm2', 'h']);
  assert.equal(res.statusCode, 200);
  assert.equal(res.bodyText, 'done');
});

test('R4-S2: path-scoped middleware boundary', async () => {
  const app = express();
  const hits: string[] = [];
  app.use('/admin', (_req, _res, next) => { hits.push('admin-mw'); next(); });
  app.get('/administrator', (_req, res, _next) => { hits.push('administrator-h'); res.end('admin page'); });
  app.get('/admin/users', (_req, res, _next) => { hits.push('admin-users-h'); res.end('users'); });

  // /admin/users → middleware runs (prefix match on segment boundary), then h.
  const inside = await makeRequest(app, { method: 'GET', url: '/admin/users' });
  assert.deepEqual(hits, ['admin-mw', 'admin-users-h']);
  assert.equal(inside.bodyText, 'users');

  // /administrator → NO prefix bleed: only the route handler runs.
  hits.length = 0;
  const outside = await makeRequest(app, { method: 'GET', url: '/administrator' });
  assert.deepEqual(hits, ['administrator-h']);
  assert.equal(outside.bodyText, 'admin page');
});

test('R4-S3: short-circuit without next', async () => {
  const app = express();
  const order: string[] = [];
  app.use((_req, res, _next) => { order.push('mw'); res.end('short'); }); // no next()
  app.get('/x', (_req, _res, _next) => { order.push('h'); });

  const res = await makeRequest(app, { method: 'GET', url: '/x' });
  assert.deepEqual(order, ['mw']); // h never runs
  assert.equal(res.statusCode, 200);
  assert.equal(res.bodyText, 'short');
});

// R12-S1: next('route') inside a route's handler chain skips the remaining
// handlers of the current route and continues at the next layer of the stack.

test('R12-S1: next(route) skips route handlers', async () => {
  const app = express();
  const order: string[] = [];
  app.get('/x',
    (_req, _res, next) => { order.push('h1'); next('route'); },
    (_req, _res, _next) => { order.push('h2'); },
    (_req, _res, _next) => { order.push('h3'); },
  );
  app.use((_req, res, _next) => { order.push('finisher'); res.end('fin'); });

  const res = await makeRequest(app, { method: 'GET', url: '/x' });
  assert.deepEqual(order, ['h1', 'finisher']); // h2/h3 skipped
  assert.equal(res.bodyText, 'fin');
});

// R12-S2: next('router') inside a mounted router skips the rest of the router
// and continues at the parent layer after the mount point, with req.url and
// req.baseUrl restored (O2).

test('R12-S2: next(router) returns to parent, url restored', async () => {
  const app = express();
  const router = new Router();
  router.get('/x', (_req, _res, next) => { next('router'); });
  app.use('/api', router);

  let capturedUrl = '';
  let capturedBaseUrl = '';
  app.use((req, res, _next) => {
    capturedUrl = req.url ?? '';
    capturedBaseUrl = req.baseUrl;
    res.end('fin');
  });

  const res = await makeRequest(app, { method: 'GET', url: '/api/x' });
  assert.equal(capturedUrl, '/api/x', 'url restored to the parent view');
  assert.equal(capturedBaseUrl, '', 'baseUrl restored to the top-level value');
  assert.equal(res.bodyText, 'fin');
});