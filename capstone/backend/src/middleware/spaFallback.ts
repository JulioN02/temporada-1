import { existsSync } from 'node:fs'
import path from 'node:path'
import type { RequestHandler } from 'express'

/**
 * SPA history fallback (T-1-8 / capstone-ui it1, R-BE-5). Plain middleware —
 * NOT `app.get('*')` (Express 5 path-to-regexp v8 wildcard pitfalls).
 *
 * Contract: only GET requests that are NOT under `/api/` fall back to the
 * Vite build's index.html (client-side routing); `/api/*` requests that match
 * no route keep the JSON 404 (the fallback never swallows them). A missing
 * build (no ui/dist yet) passes through → JSON 404, never a 500.
 *
 * Ordering in app.ts: API routers → express.static(uiDistDir) → this fallback
 * → notFoundHandler (JSON 404) → errorHandler — static assets always win.
 */
export function createSpaFallback(uiDistDir: string): RequestHandler {
  const indexHtml = path.join(uiDistDir, 'index.html')
  return (req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next()
    if (!existsSync(indexHtml)) return next() // no build yet → JSON 404 downstream
    res.sendFile(indexHtml)
  }
}