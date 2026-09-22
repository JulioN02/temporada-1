import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

import express from '../src/app.ts';
import { Router } from '../src/router.ts';
import { json } from '../src/middleware/json.ts';
import { urlencoded } from '../src/middleware/urlencoded.ts';
import { makeRequest, type MakeRequestOptions } from './helpers.ts';

// R15: listen() wraps http.createServer and returns a real server (the surface
// already existed since G2 — this suite locks its real-HTTP behavior). The e2e
// suite validates PARITY between the in-memory fake (makeRequest, D8) and real
// HTTP (app.listen(0) + global fetch): status, Content-Type and raw body must
// be identical for routes+params, body json, body urlencoded, query, mounting
// (baseUrl/originalUrl), 404 and 500.
//
// Keep-alive gotcha (design §9): undici keeps sockets open, so server.close()
// alone would hang — closeAllConnections() in the after hook is mandatory.

test('R15-S1: real-HTTP parity smoke', async (t) => {
  const app = express();
  app.use(json());
  app.use(urlencoded());

  // routes + params + query echo (also locks req.url / originalUrl / baseUrl).
  app.get('/users/:id', (req, res) => {
    res.json({
      id: req.params.id,
      query: req.query,
      url: req.url,
      originalUrl: req.originalUrl,
      baseUrl: req.baseUrl,
    });
  });

  // body echo — json() and urlencoded() are both mounted, so POST /echo covers
  // both parsers depending on the Content-Type sent.
  app.post('/echo', (req, res) => {
    res.json({ body: req.body });
  });

  // mounted router: params + stripped url + baseUrl + originalUrl intact.
  const router = new Router();
  router.get('/users/:id', (req, res) => {
    res.json({
      id: req.params.id,
      url: req.url,
      baseUrl: req.baseUrl,
      originalUrl: req.originalUrl,
    });
  });
  app.use('/api', router);

  // 500 path: plain error reaching the end of the stack → finalhandler.
  app.get('/boom', (_req, _res, next) => {
    next(new Error('boom'));
  });

  const server = app.listen(0);
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // Dispatch the same request in-memory and over real HTTP, then require
  // status, Content-Type and raw body to be identical.
  async function assertParity(opts: MakeRequestOptions): Promise<void> {
    const fake = await makeRequest(app, opts);
    // fetch's BodyInit rejects Buffer<ArrayBufferLike>; the parity suite only
    // sends string bodies, so normalize to a UTF-8 string up front.
    const realBody =
      opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : opts.body.toString('utf8');
    const real = await fetch(base + opts.url, {
      method: opts.method,
      headers: opts.headers ?? {},
      // Conditional spread: exactOptionalPropertyTypes forbids passing
      // `body: undefined` explicitly to the optional RequestInit.body.
      ...(realBody !== undefined ? { body: realBody } : {}),
    });
    const label = `${opts.method} ${opts.url}`;
    assert.equal(real.status, fake.statusCode, `status parity for ${label}`);
    assert.equal(
      real.headers.get('content-type'),
      fake.getHeader('Content-Type'),
      `content-type parity for ${label}`,
    );
    assert.equal(await real.text(), fake.bodyText, `body parity for ${label}`);
  }

  // 1. routes + params + query (repeated keys and + decoding).
  await assertParity({ method: 'GET', url: '/users/7?x=1&x=2&q=a+b' });

  // 2. body json.
  await assertParity({
    method: 'POST',
    url: '/echo',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: '{"a":1}',
  });

  // 3. body urlencoded (flat node:querystring semantics).
  await assertParity({
    method: 'POST',
    url: '/echo',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'name=Ana+Maria&age=30',
  });

  // 4. mounting: prefix stripped inside the router, baseUrl/originalUrl parity.
  await assertParity({ method: 'GET', url: '/api/users/7?x=1' });

  // 5. 404 fallback (unknown path).
  await assertParity({ method: 'GET', url: '/nope' });

  // 6. 500 fallback (plain error, generic body — raw message not exposed).
  await assertParity({ method: 'GET', url: '/boom' });
});