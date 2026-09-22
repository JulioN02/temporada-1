import { test } from 'node:test';
import assert from 'node:assert/strict';

import express from '../src/app.ts';
import { BODY_LIMIT, json } from '../src/middleware/json.ts';
import { urlencoded } from '../src/middleware/urlencoded.ts';
import { makeRequest } from './helpers.ts';

// R8: json() body parser — application/json (charset suffix allowed) → req.body;
// malformed → 400; empty body with matching CT → {}; non-matching CT → untouched.

test('R8-S1: valid JSON parsed', async () => {
  const app = express();
  let captured: unknown;
  app.use(json());
  app.post('/echo', (req, res, _next) => {
    captured = req.body;
    res.end('ok');
  });

  const res = await makeRequest(app, {
    method: 'POST',
    url: '/echo',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: '{"a":1}',
  });
  assert.deepEqual(captured, { a: 1 });
  assert.equal(res.statusCode, 200);
  assert.equal(res.bodyText, 'ok');
});

test('R8-S2: malformed JSON -> 400', async () => {
  const app = express();
  let handlerRan = false;
  app.use(json());
  app.post('/echo', (_req, res, _next) => { handlerRan = true; res.end('ok'); });

  const res = await makeRequest(app, {
    method: 'POST',
    url: '/echo',
    headers: { 'content-type': 'application/json' },
    body: '{oops',
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.bodyText, 'Invalid JSON');
  assert.equal(handlerRan, false, 'route handler must NOT run');
});

test('R8-S3: empty body -> {}', async () => {
  const app = express();
  let captured: unknown;
  app.use(json());
  app.post('/echo', (req, res, _next) => {
    captured = req.body;
    res.end('ok');
  });

  const res = await makeRequest(app, {
    method: 'POST',
    url: '/echo',
    headers: { 'content-type': 'application/json' },
    body: '',
  });
  assert.deepEqual(captured, {});
  assert.equal(res.statusCode, 200);
  assert.equal(res.bodyText, 'ok');
});

// R9: urlencoded() parser — flat node:querystring semantics (+ → space,
// percent-decoding, repeated keys → array); re-read guard; CT mismatch passes
// through leaving req.body undefined.

test('R9-S1: urlencoded parsed flat', async () => {
  const app = express();
  let captured: unknown;
  app.use(urlencoded());
  app.post('/echo', (req, res, _next) => {
    captured = req.body;
    res.end('ok');
  });

  const res = await makeRequest(app, {
    method: 'POST',
    url: '/echo',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'name=Ana+Maria&age=30',
  });
  assert.deepEqual(captured, { name: 'Ana Maria', age: '30' });
  assert.equal(res.statusCode, 200);
});

test('R9-S2: unknown content-type pass-through', async () => {
  const app = express();
  let captured: unknown;
  let handlerRan = false;
  app.use(json());
  app.use(urlencoded());
  app.post('/echo', (req, res, _next) => {
    captured = req.body;
    handlerRan = true;
    res.end('ok');
  });

  const res = await makeRequest(app, {
    method: 'POST',
    url: '/echo',
    headers: { 'content-type': 'text/plain' },
    body: 'hello',
  });
  assert.equal(captured, undefined, 'req.body stays undefined');
  assert.equal(handlerRan, true, 'route handler runs');
  assert.equal(res.bodyText, 'ok');
});

test('R9-S3: re-read guard (json then urlencoded)', async () => {
  const app = express();
  let captured: unknown;
  app.use(json());
  app.use(urlencoded());
  app.post('/echo', (req, res, _next) => {
    captured = req.body;
    res.end('ok');
  });

  const res = await makeRequest(app, {
    method: 'POST',
    url: '/echo',
    headers: { 'content-type': 'application/json' },
    body: '{"a":1}',
  });
  assert.deepEqual(captured, { a: 1 }); // urlencoded() must not re-read or overwrite
  assert.equal(res.statusCode, 200);
  assert.equal(res.bodyText, 'ok');
});

// R9-S4 (lock, micro-contract 5): repeated keys in a urlencoded body → array,
// same node:querystring semantics as query (R10-S2).

test('R9-S4: repeated keys -> array (micro-contract 5)', async () => {
  const app = express();
  let captured: unknown;
  app.use(urlencoded());
  app.post('/echo', (req, res, _next) => {
    captured = req.body;
    res.end('ok');
  });

  const res = await makeRequest(app, {
    method: 'POST',
    url: '/echo',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'tags=a&tags=b&tags=c',
  });
  assert.deepEqual(captured, { tags: ['a', 'b', 'c'] });
  assert.equal(res.statusCode, 200);
  assert.equal(res.bodyText, 'ok');
});

// R8-S4 (P2): body over the size limit → 413 'Payload Too Large'; the limit is
// configurable via {limit} on json() and urlencoded() (default BODY_LIMIT = 100kb).

test('R8-S4: body over limit -> 413, configurable {limit}', async () => {
  // Default limit (BODY_LIMIT = 100kb): a larger body is rejected with 413 and
  // the route handler never runs.
  const app = express();
  let handlerRan = false;
  app.use(json());
  app.post('/echo', (_req, res, _next) => { handlerRan = true; res.end('ok'); });

  const overDefault = await makeRequest(app, {
    method: 'POST',
    url: '/echo',
    headers: { 'content-type': 'application/json' },
    body: `{"data":"${'x'.repeat(BODY_LIMIT)}"}`,
  });
  assert.equal(overDefault.statusCode, 413);
  assert.equal(overDefault.bodyText, 'Payload Too Large');
  assert.equal(handlerRan, false, 'route handler must not run');

  // Configurable limit: json({limit}) rejects a smaller body too.
  const small = express();
  let smallHandlerRan = false;
  small.use(json({ limit: 32 }));
  small.post('/echo', (_req, res, _next) => { smallHandlerRan = true; res.end('ok'); });

  const overCustom = await makeRequest(small, {
    method: 'POST',
    url: '/echo',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ payload: 'x'.repeat(64) }),
  });
  assert.equal(overCustom.statusCode, 413);
  assert.equal(overCustom.bodyText, 'Payload Too Large');
  assert.equal(smallHandlerRan, false);

  // urlencoded({limit}) honors the same configurable limit.
  const enc = express();
  let encHandlerRan = false;
  enc.use(urlencoded({ limit: 32 }));
  enc.post('/echo', (_req, res, _next) => { encHandlerRan = true; res.end('ok'); });

  const overEnc = await makeRequest(enc, {
    method: 'POST',
    url: '/echo',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `payload=${'x'.repeat(64)}`,
  });
  assert.equal(overEnc.statusCode, 413);
  assert.equal(overEnc.bodyText, 'Payload Too Large');
  assert.equal(encHandlerRan, false);
});