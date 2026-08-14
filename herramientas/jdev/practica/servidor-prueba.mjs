#!/usr/bin/env node
/**
 * Servidor HTTP local de práctica para `jdev http`.
 *
 * Uso:
 *   node practica/servidor-prueba.mjs            # arranca en http://127.0.0.1:8787
 *   node practica/servidor-prueba.mjs 9999       # puerto custom
 *
 * Endpoints:
 *   GET  /             → JSON simple con estado del servicio
 *   GET  /json         → JSON anidado (pruébalo: jdev http …/json | jdev json format)
 *   GET  /set-cookie   → responde con DOS cookies set-cookie (la salida las enmascara)
 *   POST /echo         → devuelve método, headers y body que le mandaste
 *   GET  /lento        → responde recién a los 5 segundos (para probar --timeout)
 *   GET  /error        → 500 con cuerpo JSON de error
 *   GET  /no-encontrado → 404
 */
import { createServer } from 'node:http'

const PORT = Number(process.argv[2] ?? 8787)

const server = createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8')
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const send = (status, payload, extraHeaders = {}) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extraHeaders })
      res.end(JSON.stringify(payload))
    }

    if (req.method === 'POST' && url.pathname === '/echo') {
      return send(200, {
        servicio: 'echo',
        metodo: req.method,
        url: url.pathname,
        headers: req.headers,
        body,
        recibidoEn: new Date().toISOString(),
      })
    }

    if (req.method === 'GET' && url.pathname === '/') {
      return send(200, { servicio: 'jdev-practica', estado: 'ok', endpoints: ['/json', '/echo', '/lento', '/error', '/no-encontrado'] })
    }

    if (req.method === 'GET' && url.pathname === '/json') {
      return send(200, { usuario: { nombre: 'Julio', roles: ['dev', 'admin'], tags: ['ts', 'cli', 'node'] }, activo: true, cuota: 0.87 })
    }

    if (req.method === 'GET' && url.pathname === '/set-cookie') {
      return send(200, { ok: true }, { 'set-cookie': ['sesion=abc123; Path=/; HttpOnly', 'tema=oscuro; Path=/'] })
    }

    if (req.method === 'GET' && url.pathname === '/lento') {
      setTimeout(() => send(200, { ok: true, tardanza: '5 segundos' }), 5000)
      return
    }

    if (req.method === 'GET' && url.pathname === '/error') {
      return send(500, { error: 'error interno simulado', detalle: 'boom' })
    }

    return send(404, { error: 'no encontrado', ruta: url.pathname })
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Servidor de práctica jdev escuchando en http://127.0.0.1:${PORT}`)
  console.log('Endpoints: /  /json  /set-cookie  POST /echo  /lento  /error  /no-encontrado')
  console.log('Detené con Ctrl+C')
})