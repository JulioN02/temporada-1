import { test } from 'node:test';
import assert from 'node:assert/strict';

import express from '../src/app.ts';
import { Router } from '../src/router.ts';
import { makeRequest } from './helpers.ts';

// R11: router mounting — app.use('/prefix', router) strips the prefix from
// req.url (path only, query preserved), sets req.baseUrl ('' at top level),
// keeps req.originalUrl intact (O3), concatenates baseUrl across nested
// mounts, and restores url/baseUrl after the router yields.

test('R11-S1: mount strips prefix, sets baseUrl, originalUrl intact', async () => {
  const app = express();
  const router = new Router();
  let capturedUrl = '';
  let capturedBaseUrl = '';
  let capturedId: string | undefined;
  let capturedOriginalUrl = '';
  router.get('/users/:id', (req, res, _next) => {
    capturedUrl = req.url ?? '';
    capturedBaseUrl = req.baseUrl;
    capturedId = req.params.id;
    capturedOriginalUrl = req.originalUrl;
    res.end('ok');
  });
  app.use('/api', router);

  const res = await makeRequest(app, { method: 'GET', url: '/api/users/7?x=1' });
  assert.equal(capturedUrl, '/users/7?x=1', 'prefix stripped, query preserved');
  assert.equal(capturedBaseUrl, '/api');
  assert.equal(capturedId, '7');
  assert.equal(capturedOriginalUrl, '/api/users/7?x=1');
  assert.equal(res.statusCode, 200);
  assert.equal(res.bodyText, 'ok');
});

test('R11-S2: prefix boundary on mount', async () => {
  const app = express();
  const router = new Router();
  let capturedUrl: string | undefined;
  router.get('/', (req, res, _next) => {
    capturedUrl = req.url ?? '';
    res.end('root');
  });
  app.use('/api', router);

  // /apix does NOT enter the router (boundary: no '/' or end after /api).
  const outside = await makeRequest(app, { method: 'GET', url: '/apix' });
  assert.equal(outside.statusCode, 404);
  assert.equal(capturedUrl, undefined, 'router handler must not run for /apix');

  // /api enters with req.url === '/' (empty remainder).
  const exact = await makeRequest(app, { method: 'GET', url: '/api' });
  assert.equal(capturedUrl, '/');
  assert.equal(exact.bodyText, 'root');

  // /api/ also enters.
  const trailing = await makeRequest(app, { method: 'GET', url: '/api/' });
  assert.equal(capturedUrl, '/');
  assert.equal(trailing.bodyText, 'root');
});

test('R11-S3: nested mount concatenates baseUrl', async () => {
  const app = express();
  const r2 = new Router();
  let capturedBaseUrl = '';
  let capturedOriginalUrl = '';
  r2.get('/ping', (req, res, _next) => {
    capturedBaseUrl = req.baseUrl;
    capturedOriginalUrl = req.originalUrl;
    res.end('pong');
  });
  const r1 = new Router();
  r1.use('/v1', r2);
  app.use('/api', r1);

  const res = await makeRequest(app, { method: 'GET', url: '/api/v1/ping' });
  assert.equal(capturedBaseUrl, '/api/v1');
  assert.equal(capturedOriginalUrl, '/api/v1/ping');
  assert.equal(res.statusCode, 200);
  assert.equal(res.bodyText, 'pong');
});