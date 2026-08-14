import { createServer, type IncomingMessage, type ServerResponse } from 'node:https'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export interface RecordedRequest {
  method: string
  url: string
  headers: NodeJS.Dict<string | string[]>
  body: string
}

export interface HttpsServerHandle {
  url: string
  requests: RecordedRequest[]
  close: () => Promise<void>
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void

const CERT = fileURLToPath(new URL('../fixtures/https/cert.pem', import.meta.url))
const KEY = fileURLToPath(new URL('../fixtures/https/key.pem', import.meta.url))

/** TEST-ONLY TLS server over the committed static self-signed fixture certs. */
export function startHttpsServer(handler: Handler): Promise<HttpsServerHandle> {
  const requests: RecordedRequest[] = []
  const server = createServer({ key: readFileSync(KEY), cert: readFileSync(CERT) }, (req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      })
      // Connection: close so the child CLI process exits right after the response
      res.setHeader('Connection', 'close')
      handler(req, res)
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('https server bound to an unexpected address'))
        return
      }
      resolve({
        url: `https://127.0.0.1:${address.port}/`,
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