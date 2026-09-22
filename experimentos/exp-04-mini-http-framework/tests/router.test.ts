import { test } from 'node:test';
import assert from 'node:assert/strict';

import express from '../src/app.ts';
import { Router } from '../src/router.ts';
import type { AppRequest } from '../src/request.ts';
import type { AppResponse } from '../src/response.ts';
import { FakeRequest, FakeResponse, makeRequest } from './helpers.ts';

// R1: app factory & public surface — express() exposes the Express 5 public
// names and handle() dispatches in-memory without a server (D8).

test('R1-S1: factory surface & in-memory dispatch', async () => {
  const app = express();
  const seen: string[] = [];
  app.get('/ping', (_req, res, _next) => {
    seen.push('ping');
    res.end('pong');
  });

  // Surface: every Express 5 public name must exist as a function.
  const surface = ['use', 'get', 'post', 'put', 'patch', 'delete', 'all', 'listen', 'handle'];
  for (const name of surface) {
    assert.equal(typeof (app as unknown as Record<string, unknown>)[name], 'function', `${name} is a function`);
  }

  // In-memory dispatch: no server started, handler runs and writes to the fake.
  const res = await makeRequest(app, { method: 'GET', url: '/ping' });
  assert.deepEqual(seen, ['ping']);
  assert.equal(res.statusCode, 200);
  assert.equal(res.bodyText, 'pong');
});

// R2: route registration & method matching — app.METHOD registers FIFO; a
// request matches only when method AND full path match; app.all() matches any
// method; multiple handlers on the same route run in registration order.

test('R2-S1: methods respond on match', async () => {
  const app = express();
  const seen: string[] = [];
  app.get('/a', (_req, res, _next) => { seen.push('get-a'); res.end('ga'); });
  app.post('/a', (_req, res, _next) => { seen.push('post-a'); res.end('pa'); });
  app.put('/b', (_req, res, _next) => { seen.push('put-b'); res.end('pb'); });
  app.patch('/b', (_req, res, _next) => { seen.push('patch-b'); res.end('pcb'); });
  app.delete('/b', (_req, res, _next) => { seen.push('delete-b'); res.end('db'); });

  const cases: Array<[string, string, string]> = [
    ['GET', '/a', 'ga'],
    ['POST', '/a', 'pa'],
    ['PUT', '/b', 'pb'],
    ['PATCH', '/b', 'pcb'],
    ['DELETE', '/b', 'db'],
  ];
  for (const [method, url, expectedBody] of cases) {
    const res = await makeRequest(app, { method, url });
    assert.equal(res.bodyText, expectedBody, `${method} ${url}`);
    assert.equal(res.statusCode, 200, `${method} ${url} status`);
  }
  // Each handler ran exactly once; no handler ran for a non-matching method.
  assert.deepEqual(seen, ['get-a', 'post-a', 'put-b', 'patch-b', 'delete-b']);
});

test('R2-S2: all() and route handler chain', async () => {
  const app = express();
  const seen: string[] = [];
  app.all('/x', (_req, _res, next) => { seen.push('all-h1'); next(); });
  app.get('/x', (_req, res, _next) => { seen.push('get-h2'); res.end('chain'); });

  // POST /x: only the all() layer matches (the GET layer must NOT); with h1
  // calling next() and nothing else matching, dispatch ends in 404 (O1).
  const postRes = await makeRequest(app, { method: 'POST', url: '/x' });
  assert.deepEqual(seen, ['all-h1']);
  assert.equal(postRes.statusCode, 404, 'POST /x falls through to 404');

  // GET /x: h1 runs then h2 (FIFO within the route chain) → h2's response.
  seen.length = 0;
  const getRes = await makeRequest(app, { method: 'GET', url: '/x' });
  assert.deepEqual(seen, ['all-h1', 'get-h2']);
  assert.equal(getRes.bodyText, 'chain');
});

test('R2-S3: trailing slash non-strict (/x ≡ /x/, micro-contract 9)', async () => {
  const app = express();
  let hits = 0;
  app.get('/x', (_req, res, _next) => { hits++; res.end('x'); });

  const withSlash = await makeRequest(app, { method: 'GET', url: '/x/' });
  const withoutSlash = await makeRequest(app, { method: 'GET', url: '/x' });
  assert.equal(withSlash.statusCode, 200);
  assert.equal(withoutSlash.statusCode, 200);
  assert.equal(withSlash.bodyText, 'x');
  assert.equal(withoutSlash.bodyText, 'x');
  assert.equal(hits, 2, 'both variants hit the same route');
});

// R3: params — `:name` captures exactly one raw segment, percent-decoded into
// req.params; param routes still match the full path exactly.

test('R3-S1: single param decoded', async () => {
  const app = express();
  let capturedId: string | undefined;
  app.get('/users/:id', (req, res, _next) => {
    capturedId = req.params.id;
    res.end(`id=${req.params.id}`);
  });

  const res = await makeRequest(app, { method: 'GET', url: '/users/a%20b' });
  assert.equal(capturedId, 'a b');
  assert.equal(res.statusCode, 200);
  assert.equal(res.bodyText, 'id=a b');
});

test('R3-S2: multiple params', async () => {
  const app = express();
  let capturedUid: string | undefined;
  let capturedPid: string | undefined;
  app.get('/users/:uid/posts/:pid', (req, res, _next) => {
    capturedUid = req.params.uid;
    capturedPid = req.params.pid;
    res.end(`u=${req.params.uid};p=${req.params.pid}`);
  });

  const res = await makeRequest(app, { method: 'GET', url: '/users/7/posts/9' });
  assert.equal(capturedUid, '7');
  assert.equal(capturedPid, '9');
  assert.equal(res.bodyText, 'u=7;p=9');
});

test('R3-S3: param route, no match', async () => {
  const app = express();
  let ran = false;
  app.get('/users/:id', (_req, res, _next) => { ran = true; res.end('x'); });

  for (const url of ['/users', '/users/1/extra']) {
    ran = false;
    const res = await makeRequest(app, { method: 'GET', url });
    assert.equal(res.statusCode, 404, `${url} status`);
    assert.equal(res.bodyText, 'Not Found', `${url} body`);
    assert.equal(ran, false, `${url} handler must not run`);
  }
});

// R2-S4 (lock, public API): Router.route(path) registers a route layer that
// matches ANY method (method undefined, same semantics as all()); it returns
// the Route so handlers can be pushed onto its chain. Router.handle needs the
// `done` callback, so dispatch is exercised directly (not via makeRequest).

test('R2-S4: Router.route() registers an any-method route layer', () => {
  const router = new Router();
  const route = router.route('/x');
  let hits = 0;
  route.handlers.push((_req, res, _next) => { hits++; res.end('via-route'); });

  // GET dispatches through the route layer.
  const getReq = new FakeRequest('GET', '/x');
  const getRes = new FakeResponse();
  router.handle(getReq as unknown as AppRequest, getRes as unknown as AppResponse, () => {});
  assert.equal(hits, 1, 'GET must hit the route');
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.bodyText, 'via-route');

  // A different method also matches (route() is any-method, like all()).
  const postReq = new FakeRequest('POST', '/x');
  const postRes = new FakeResponse();
  router.handle(postReq as unknown as AppRequest, postRes as unknown as AppResponse, () => {});
  assert.equal(hits, 2, 'POST must also hit the route');
  assert.equal(postRes.statusCode, 200);
  assert.equal(postRes.bodyText, 'via-route');
});