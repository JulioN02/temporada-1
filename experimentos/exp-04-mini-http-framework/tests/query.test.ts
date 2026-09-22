import { test } from 'node:test';
import assert from 'node:assert/strict';

import express from '../src/app.ts';
import { makeRequest } from './helpers.ts';

// R10: 'simple' eager query — populated ONCE per request via node:querystring
// (percent-decoding, + → space, repeated keys → array); never a lazy getter.

test('R10-S1: query parsed and decoded', async () => {
  const app = express();
  let capturedQ: unknown;
  let capturedTag: unknown;
  app.get('/search', (req, res, _next) => {
    capturedQ = req.query.q;
    capturedTag = req.query.tag;
    res.end('ok');
  });

  const res = await makeRequest(app, { method: 'GET', url: '/search?q=a+b&tag=%C3%A1' });
  assert.equal(capturedQ, 'a b'); // '+' decodes to space
  assert.equal(capturedTag, 'á'); // %C3%A1 decodes to 'á'
  assert.equal(res.statusCode, 200);
});

test('R10-S2: repeated keys -> array', async () => {
  const app = express();
  let captured: unknown;
  app.get('/x', (req, res, _next) => {
    captured = req.query.a;
    res.end('ok');
  });

  const res = await makeRequest(app, { method: 'GET', url: '/x?a=1&a=2' });
  assert.deepEqual(captured, ['1', '2']);
  assert.equal(res.statusCode, 200);
});

test('R10-S3: empty query, eager value', async () => {
  const app = express();
  let seenInMiddleware: unknown;
  let seenInHandler: unknown;
  // The FIRST middleware must already see the plain object {} — eager, not a getter.
  app.use((req, _res, next) => {
    seenInMiddleware = req.query;
    next();
  });
  app.get('/x', (req, res, _next) => {
    seenInHandler = req.query;
    res.end('ok');
  });

  const res = await makeRequest(app, { method: 'GET', url: '/x' });
  assert.deepEqual(seenInMiddleware, {});
  assert.equal(Object.getPrototypeOf(seenInMiddleware), Object.prototype);
  assert.deepEqual(seenInHandler, {});
  assert.equal(res.statusCode, 200);
});