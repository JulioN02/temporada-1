import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { DEFAULT_TIMEOUT_MS, request } from '../src/core/http.ts'
import { renderHttp } from '../src/cli/http.ts'
import { HttpError } from '../src/core/errors.ts'
import { runCliAsync } from './helpers/exec.ts'
import { startHttpsServer } from './helpers/https-server.ts'

// ---------------------------------------------------------------------------
// core + renderer unit tests (pure, no sockets)
// ---------------------------------------------------------------------------

describe('renderHttp (pure renderer)', async () => {
  const green = '\x1b[32m'
  const yellow = '\x1b[33m'
  const red = '\x1b[31m'
  const reset = '\x1b[0m'

  it('exact layout: status line, lowercase headers in insertion order, blank line, raw body', async () => {
    const out = renderHttp(
      {
        status: 200,
        statusText: 'OK',
        headers: [
          ['content-type', 'application/json'],
          ['content-length', '11'],
        ],
        body: '{"ok":true}',
      },
      false,
    )
    assert.equal(out, 'HTTP/1.1 200 OK\ncontent-type: application/json\ncontent-length: 11\n\n{"ok":true}')
  })

  it('empty body: layout still ends with the blank separator line', async () => {
    const out = renderHttp({ status: 204, statusText: 'No Content', headers: [], body: '' }, false)
    assert.equal(out, 'HTTP/1.1 204 No Content\n\n')
  })

  it('404 keeps curl semantics: status line + headers + body, no exit mapping here', async () => {
    const out = renderHttp({ status: 404, statusText: 'Not Found', headers: [['content-type', 'text/plain']], body: 'nope' }, false)
    assert.equal(out, 'HTTP/1.1 404 Not Found\ncontent-type: text/plain\n\nnope')
  })

  it('MASKING: authorization, cookie and set-cookie values replaced by ***', async () => {
    const out = renderHttp(
      {
        status: 200,
        statusText: 'OK',
        headers: [
          ['authorization', 'Bearer secreto123'],
          ['cookie', 'session=abc'],
          ['set-cookie', 'a=1; Path=/'],
          ['set-cookie', 'b=2; Path=/'],
          ['x-safe', 'visible'],
        ],
        body: 'ok',
      },
      false,
    )
    assert.ok(out.includes('authorization: ***'))
    assert.ok(out.includes('cookie: ***'))
    assert.ok(out.includes('set-cookie: ***'))
    assert.equal(out.split('set-cookie: ***').length - 1, 2, 'every set-cookie line masked')
    assert.ok(out.includes('x-safe: visible'))
    assert.ok(!out.includes('secreto123') && !out.includes('session=abc') && !out.includes('a=1'))
  })

  it('MASKING is case-insensitive on the header name', async () => {
    const out = renderHttp(
      { status: 200, statusText: 'OK', headers: [['Authorization', 'Bearer X'], ['Set-Cookie', 'y=1']], body: '' },
      false,
    )
    assert.match(out, /authorization: \*\*\*/i)
    assert.match(out, /set-cookie: \*\*\*/i)
    assert.ok(!out.includes('Bearer X'))
  })

  it('color: 2xx green, 4xx yellow, 5xx red only on the status line; off when color=false', async () => {
    const ok = renderHttp({ status: 200, statusText: 'OK', headers: [], body: 'b' }, true)
    assert.equal(ok.slice(0, `${green}HTTP/1.1 200 OK${reset}\n`.length), `${green}HTTP/1.1 200 OK${reset}\n`)
    assert.ok(!ok.slice(`${green}HTTP/1.1 200 OK${reset}\n`.length).includes('\x1b'), 'body/headers never colorized')

    const nf = renderHttp({ status: 404, statusText: 'Not Found', headers: [], body: '' }, true)
    assert.ok(nf.startsWith(`${yellow}HTTP/1.1 404 Not Found${reset}\n`))

    const err = renderHttp({ status: 500, statusText: 'Internal Server Error', headers: [], body: '' }, true)
    assert.ok(err.startsWith(`${red}HTTP/1.1 500 Internal Server Error${reset}\n`))

    const plain = renderHttp({ status: 200, statusText: 'OK', headers: [], body: '' }, false)
    assert.ok(!plain.includes('\x1b'))
  })
})

describe('core/http constants', async () => {
  it('DEFAULT_TIMEOUT_MS is exactly 30 seconds (asserted as a constant, not lived)', async () => {
    assert.equal(DEFAULT_TIMEOUT_MS, 30000)
  })

  it('request: missing host -> { ok: false, error: HttpError } (network family)', async () => {
    const result = await request('http://no-such-host.invalid/')
    assert.equal(result.ok, false)
    assert.ok(result.error instanceof HttpError)
    assert.match(result.error.message, /network/i)
  })
})

// ---------------------------------------------------------------------------
// CLI end-to-end against local servers
// ---------------------------------------------------------------------------

interface PlainServerHandle {
  url: string
  requests: Array<{ method: string; url: string; headers: NodeJS.Dict<string | string[]>; body: string }>
  close: () => Promise<void>
}

function startPlainServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<PlainServerHandle> {
  const requests: PlainServerHandle['requests'] = []
  const server = createHttpServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', async () => {
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      })
      res.setHeader('Connection', 'close')
      handler(req, res)
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', async () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('http server bound to an unexpected address'))
        return
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/`,
        requests,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections()
            server.close(() => done())
          }),
      })
    })
  })
}

describe('http CLI', async () => {
  let server: PlainServerHandle
  let httpsServer: Awaited<ReturnType<typeof startHttpsServer>>

  before(async () => {
    server = await startPlainServer((req, res) => {
      if (req.url === '/echo') {
        // echo the sensitive request headers back so masking is observable
        res.setHeader('content-type', 'application/json')
        if (req.headers.authorization !== undefined) res.setHeader('authorization', req.headers.authorization)
        if (req.headers.cookie !== undefined) res.setHeader('cookie', req.headers.cookie)
        res.end('{"echoed":true}')
        return
      }
      res.setHeader('content-type', 'application/json')
      res.end('{"ok":true}')
    })
    httpsServer = await startHttpsServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"secure":true}')
    })
  })

  after(async () => {
    await server.close()
    await httpsServer.close()
  })

  it('GET 200: first line HTTP/1.1 200 OK, content-type line present, body last, exit 0', async () => {
    const r = await runCliAsync(['http', server.url])
    assert.equal(r.status, 0)
    assert.equal(r.stderr, '')
    const lines = r.stdout.split('\n')
    assert.equal(lines[0]!, 'HTTP/1.1 200 OK')
    assert.ok(r.stdout.includes('content-type: application/json'))
    assert.ok(r.stdout.endsWith('{"ok":true}'), `body must be the final line, got: ${JSON.stringify(r.stdout.slice(-30))}`)
  })

  it('404 semantics: status line + body printed, exit 0', async () => {
    const srv = await startPlainServer((_req, res) => {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found body')
    })
    try {
      const r = await runCliAsync(['http', srv.url])
      assert.equal(r.status, 0)
      assert.ok(r.stdout.includes('HTTP/1.1 404 Not Found'))
      assert.ok(r.stdout.endsWith('not found body'))
    } finally {
      await srv.close()
    }
  })

  it('authorization masked: echoed response header shows authorization: ***, secret never present', async () => {
    const r = await runCliAsync(['http', '-H', 'Authorization: Bearer secreto123', `${server.url}echo`])
    assert.equal(r.status, 0)
    assert.ok(r.stdout.includes('authorization: ***'), `expected masked header, got:\n${r.stdout}`)
    assert.ok(!`${r.stdout}${r.stderr}`.includes('secreto123'), 'secret leaked into output')
    const last = server.requests[server.requests.length - 1]!
    assert.equal(last.headers.authorization, 'Bearer secreto123', 'server received the REAL unmasked header')
  })

  it('cookie + set-cookie masked (request cookie echoed and two response cookies)', async () => {
    const srv = await startPlainServer((req, res) => {
      res.setHeader('set-cookie', ['a=1; Path=/', 'b=2; Path=/'])
      if (req.headers.cookie !== undefined) res.setHeader('cookie', req.headers.cookie)
      res.end('ok')
    })
    try {
      const r = await runCliAsync(['http', '-H', 'Cookie: session=abc', srv.url])
      assert.equal(r.status, 0)
      assert.equal((r.stdout.match(/^cookie: \*\*\*$/gm) ?? []).length, 1, 'request cookie echoed and masked')
      assert.equal((r.stdout.match(/^set-cookie: \*\*\*$/gm) ?? []).length, 2, 'both set-cookie headers expanded and masked')
      assert.ok(!`${r.stdout}${r.stderr}`.includes('session=abc'))
      assert.ok(!`${r.stdout}${r.stderr}`.includes('a=1; Path=/'))
    } finally {
      await srv.close()
    }
  })

  it('TLS: self-signed plain -> exit 2, stdout EMPTY, stderr mentions certificate', async () => {
    const r = await runCliAsync(['http', httpsServer.url])
    assert.equal(r.status, 2)
    assert.equal(r.stdout, '')
    assert.notEqual(r.stderr, '')
    assert.match(r.stderr, /certificate|TLS|self-signed/i)
    assert.doesNotMatch(r.stderr, /^\s+at /m, 'no stack frames')
  })

  it('--insecure: succeeds against self-signed AND response is masked', async () => {
    const r = await runCliAsync(['http', '--insecure', '-H', 'Authorization: Bearer secreto123', httpsServer.url])
    assert.equal(r.status, 0)
    assert.ok(r.stdout.endsWith('{"secure":true}'))
    assert.ok(!`${r.stdout}${r.stderr}`.includes('secreto123'))
  })

  it('--insecure on plain http also works (agent only engages for https)', async () => {
    const r = await runCliAsync(['http', '--insecure', server.url])
    assert.equal(r.status, 0)
    assert.ok(r.stdout.startsWith('HTTP/1.1 200 OK'))
  })

  it('timeout: --timeout 1 against a never-responding server -> exit 2 within ~5s', async () => {
    const srv = await startPlainServer(() => {
      /* never responds */
    })
    try {
      const start = Date.now()
      const r = await runCliAsync(['http', '--timeout', '1', srv.url])
      const elapsed = Date.now() - start
      assert.equal(r.status, 2)
      assert.equal(r.stdout, '')
      assert.match(r.stderr, /timeout/i)
      assert.ok(elapsed < 5000, `expected abort around 1s, took ${elapsed}ms`)
      assert.ok(elapsed >= 500, `suspiciously fast (${elapsed}ms)`)
    } finally {
      await srv.close()
    }
  })

  it('invalid --timeout is a usage error (exit 1)', async () => {
    const r = await runCliAsync(['http', '--timeout', 'abc', server.url])
    assert.equal(r.status, 1)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /--timeout/)
  })

  it('DNS failure: exit 2, stdout empty, stderr non-empty', async () => {
    const r = await runCliAsync(['http', 'http://no-such-host.invalid/'])
    assert.equal(r.status, 2)
    assert.equal(r.stdout, '')
    assert.notEqual(r.stderr, '')
  })

  it('POST with data: server receives POST, exact body and content-type; response printed', async () => {
    const r = await runCliAsync(['http', '-X', 'POST', '-d', '{"a":1}', '-H', 'content-type: application/json', server.url])
    assert.equal(r.status, 0)
    const last = server.requests[server.requests.length - 1]!
    assert.equal(last.method, 'POST')
    assert.equal(last.body, '{"a":1}')
    assert.equal(last.headers['content-type'], 'application/json')
    assert.ok(r.stdout.startsWith('HTTP/1.1 200 OK'))
  })

  it('-d without -X implies POST (curl semantics)', async () => {
    await runCliAsync(['http', '-d', 'x=1', server.url])
    const last = server.requests[server.requests.length - 1]!
    assert.equal(last.method, 'POST')
    assert.equal(last.body, 'x=1')
  })

  it('GET with a body -> usage error exit 1 (fetch forbids body on GET/HEAD)', async () => {
    const r = await runCliAsync(['http', '-X', 'GET', '-d', 'x=1', server.url])
    assert.equal(r.status, 1)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /GET/)
    const head = await runCliAsync(['http', '-X', 'HEAD', '-d', 'x=1', server.url])
    assert.equal(head.status, 1)
    assert.equal(head.stdout, '')
  })

  it('-H without a colon -> usage error exit 1', async () => {
    const r = await runCliAsync(['http', '-H', 'NotAHeader', server.url])
    assert.equal(r.status, 1)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /header/)
  })

  it('missing URL -> usage error exit 1', async () => {
    const r = await runCliAsync(['http'])
    assert.equal(r.status, 1)
    assert.equal(r.stdout, '')
  })

  it('SECURITY (no-secret-on-failure): TLS failure with secret header leaks nothing', async () => {
    const r = await runCliAsync(['http', '-H', 'Authorization: Bearer Sup3rSecret', httpsServer.url])
    assert.equal(r.status, 2)
    const combined = `${r.stdout}${r.stderr}`
    assert.ok(!combined.includes('Sup3rSecret'))
    assert.ok(!combined.includes('Bearer'))
  })
})