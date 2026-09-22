import { test } from 'node:test';
import assert from 'node:assert/strict';

import express from '../src/app.ts';
import { makeRequest } from './helpers.ts';

// R13: response helpers — res.status() chainable, res.set() header, res.json()
// (application/json unless already set), res.send() minimal negotiation
// (string → text/plain; charset=utf-8; object → JSON; never overrides an
// explicitly set Content-Type).

test('R13-S1: status().set().json() chain', async () => {
  const app = express();
  app.get('/x', (_req, res, _next) => {
    res.status(201).set('X-Test', '1').json({ ok: true });
  });

  const res = await makeRequest(app, { method: 'GET', url: '/x' });
  assert.equal(res.statusCode, 201);
  assert.equal(res.getHeader('X-Test'), '1');
  assert.equal(res.getHeader('Content-Type'), 'application/json');
  assert.equal(res.bodyText, '{"ok":true}');
});

test('R13-S2: send() negotiation', async () => {
  const app = express();
  app.get('/a', (_req, res, _next) => {
    res.send('hi');
  });
  app.get('/b', (_req, res, _next) => {
    res.set('Content-Type', 'application/x-custom');
    res.send({ a: 1 });
  });

  const strRes = await makeRequest(app, { method: 'GET', url: '/a' });
  assert.equal(strRes.getHeader('Content-Type'), 'text/plain; charset=utf-8');
  assert.equal(strRes.bodyText, 'hi');

  const objRes = await makeRequest(app, { method: 'GET', url: '/b' });
  assert.equal(objRes.getHeader('Content-Type'), 'application/x-custom'); // pre-set CT respected
  assert.equal(objRes.bodyText, '{"a":1}');
});