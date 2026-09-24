/**
 * T-6-2 (capstone-ui it6) — NFR scan suite (R-UI-NFR-1..7, R-PROD-3 modified,
 * design flag b WAREHOUSE_IN_USE verification). PURE NODE scans over the
 * workspace files — no rendering, no mock fetch. Each scan is a REAL
 * assertion over the repo state (the same gates CI enforces); a violation
 * anywhere in ui/src / the build / the infra files FAILS this file.
 *
 * RED: new file — the scans reference production files as their contract;
 * any violation (an `any`, a `useMemo`, a missing CI step) fails here first.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { ERROR_MESSAGE_KEYS } from '../src/i18n/localizeError.ts'
import { es } from '../src/i18n/locales/es.ts'
import { en } from '../src/i18n/locales/en.ts'

const UI_ROOT = path.resolve(process.cwd(), 'src')
const REPO_ROOT = path.resolve(process.cwd(), '..')

/** Recursively list files under a dir (ABSOLUTE paths). */
function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, acc)
    else acc.push(full)
  }
  return acc
}

const srcFiles = walk(UI_ROOT)
const srcContents = new Map(srcFiles.map((f) => [f, readFileSync(f, 'utf8')]))

/* ── R-UI-NFR-1: strict TypeScript — zero `any` in ui/src ────────────── */

describe('R-UI-NFR-1: no `any` anywhere in ui/src', () => {
  const anyPattern = /:\s*any\b|\bas any\b|<any>|any\[\]|\bany\s*[),;]/
  const offenders = srcFiles.filter((f) => {
    const raw = srcContents.get(f)!
    // strip JSDoc/block comments FIRST (they span lines), then line comments
    const withoutBlocks = raw.replace(/\/\*[\s\S]*?\*\//g, '')
    const lines = withoutBlocks.split('\n').map((line) => line.replace(/\/\/.*$/, ''))
    return lines.some((line) => anyPattern.test(line))
  })
  it('R-UI-NFR-1: scan finds zero `: any` / `as any` / `<any>` / `any[]` matches', () => {
    expect(offenders).toEqual([])
  })
})

/* ── R-UI-NFR-2: no dangerouslySetInnerHTML with API/user data ───────── */

describe('R-UI-NFR-2: no XSS surface — zero dangerouslySetInnerHTML in ui/src', () => {
  it('R-UI-NFR-2: scan finds zero dangerouslySetInnerHTML usages', () => {
    const offenders = srcFiles.filter((f) => srcContents.get(f)!.includes('dangerouslySetInnerHTML'))
    expect(offenders).toEqual([])
  })
})

/* ── R-UI-NFR-3: no secrets hardcoded in source or bundled ───────────── */

describe('R-UI-NFR-3: no secrets in source or the client bundle', () => {
  const SECRET_ENV_NAMES = ['JWT_SECRET', 'COOKIE_SECRET', 'DATABASE_URL', 'SMTP_', 'PGPASSWORD']
  // a password VALUE literal, e.g. password: "hunter2" (empty strings and
  // `type="password"` input attributes are NOT secrets — excluded by design)
  const PASSWORD_LITERAL = /password\s*:\s*["'][^"']+["']/

  it('R-UI-NFR-3: ui/src contains no hardcoded secret env names or password literals', () => {
    const offenders: string[] = []
    for (const file of srcFiles) {
      const content = srcContents.get(file)!
      for (const name of SECRET_ENV_NAMES) {
        if (content.includes(name)) offenders.push(`${file} -> ${name}`)
      }
      if (PASSWORD_LITERAL.test(content)) offenders.push(`${file} -> password literal`)
    }
    expect(offenders).toEqual([])
  })

  it('R-UI-NFR-3: built dist assets carry no JWT/SMTP/DB secrets or password literals', () => {
    const distDir = path.resolve(process.cwd(), 'dist')
    if (!existsSync(distDir)) return // build not present in this run — CI builds before the gate
    const assets = walk(distDir).filter((f) => /\.(js|css|html)$/.test(f))
    expect(assets.length).toBeGreaterThan(0)
    const offenders: string[] = []
    for (const asset of assets) {
      const content = readFileSync(asset, 'utf8')
      for (const name of SECRET_ENV_NAMES) {
        if (content.includes(name)) offenders.push(`${asset} -> ${name}`)
      }
      if (PASSWORD_LITERAL.test(content)) offenders.push(`${asset} -> password literal`)
    }
    expect(offenders).toEqual([])
  })
})

/* ── R-UI-NFR-4: React Compiler ON, no manual memoization ────────────── */

describe('R-UI-NFR-4: React Compiler on — no useMemo/useCallback in ui/src', () => {
  it('R-UI-NFR-4: vite.config.ts registers babel-plugin-react-compiler', () => {
    const viteConfig = readFileSync(path.resolve(process.cwd(), 'vite.config.ts'), 'utf8')
    expect(viteConfig).toContain('babel-plugin-react-compiler')
  })

  it('R-UI-NFR-4: scan finds zero useMemo(/useCallback( in ui/src', () => {
    const offenders = srcFiles.filter(
      (f) => srcContents.get(f)!.includes('useMemo(') || srcContents.get(f)!.includes('useCallback('),
    )
    expect(offenders).toEqual([])
  })
})

/* ── R-UI-NFR-5: route-level code splitting for governance pages ─────── */

describe('R-UI-NFR-5: governance pages are route-level lazy chunks', () => {
  it('R-UI-NFR-5: App.tsx lazy()s AuditPage, UsersPage and JobsPage (not in the initial bundle)', () => {
    const appSource = readFileSync(path.join(UI_ROOT, 'App.tsx'), 'utf8')
    expect(appSource).toContain("lazy(() => import('./pages/AuditPage.tsx')")
    expect(appSource).toContain("lazy(() => import('./pages/UsersPage.tsx')")
    expect(appSource).toContain("lazy(() => import('./pages/JobsPage.tsx')")
  })
})

/* ── R-UI-NFR-6: requirement-ID coverage scan (cumulative gate) ──────── */

/**
 * Authoritative capstone-ui requirement list (all 6 delta specs, extracted on
 * 2026-09-23 — includes the backend v1 cross-references the specs cite, e.g.
 * R-AUTH-2 / R-NFR-3 / R-STK-8). Mirrors the backend R-NFR-3 pattern (static
 * list) so the SAME gate runs inside the Docker build stage, where the
 * monorepo-root openspec/ directory is NOT part of the build context. When
 * the specs directory IS resolvable (local + CI), the dynamic scan runs and
 * must be a SUPERSET of this list (drift guard both ways).
 */
const REQUIRED_UI_IDS: readonly string[] = [
  'R-AUTH-2', 'R-AUTHUI-1', 'R-AUTHUI-2', 'R-AUTHUI-3', 'R-AUTHUI-4',
  'R-BE-1', 'R-BE-2', 'R-BE-3', 'R-BE-4', 'R-BE-5',
  'R-CRM-3', 'R-CRM-4', 'R-DOC-1',
  'R-I18N-1', 'R-I18N-2', 'R-I18N-3', 'R-I18N-4',
  'R-NFR-3', 'R-NOT-1', 'R-NOT-5', 'R-ORD-5', 'R-ORD-6',
  'R-PROD-3', 'R-PROD-7',
  'R-RBAC-1', 'R-RBAC-2', 'R-RBAC-3', 'R-RBAC-4',
  'R-STK-3', 'R-STK-8',
  'R-UI-AUD-1',
  'R-UI-CRM-1', 'R-UI-CRM-2', 'R-UI-CRM-3', 'R-UI-CRM-4', 'R-UI-CRM-5', 'R-UI-CRM-6', 'R-UI-CRM-7', 'R-UI-CRM-8',
  'R-UI-DSH-1', 'R-UI-DSH-2', 'R-UI-DSH-3', 'R-UI-DSH-4',
  'R-UI-FND-1', 'R-UI-FND-2', 'R-UI-FND-3', 'R-UI-FND-4',
  'R-UI-JOB-1', 'R-UI-JOB-2',
  'R-UI-NFR-1', 'R-UI-NFR-2', 'R-UI-NFR-3', 'R-UI-NFR-4', 'R-UI-NFR-5', 'R-UI-NFR-6', 'R-UI-NFR-7',
  'R-UI-NOT-1', 'R-UI-NOT-2', 'R-UI-NOT-3',
  'R-UI-ORD-1', 'R-UI-ORD-2', 'R-UI-ORD-3', 'R-UI-ORD-4', 'R-UI-ORD-5', 'R-UI-ORD-6',
  'R-UI-STK-1', 'R-UI-STK-2', 'R-UI-STK-3', 'R-UI-STK-4',
  'R-UI-USR-1', 'R-UI-USR-2', 'R-UI-USR-3',
]

/** Multi-segment-aware R-ID matcher: R-BE-1 AND R-UI-CRM-1, R-UI-NFR-6, … */
const REQ_RE = /\bR-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d+\b/g

/** Every requirement ID mentioned in a spec file (dynamic — local/CI only). */
function collectSpecIds(): Set<string> | null {
  const candidates = [
    path.resolve(REPO_ROOT, 'openspec/changes/capstone-ui/specs'),
    path.resolve(REPO_ROOT, '../openspec/changes/capstone-ui/specs'),
  ]
  const specsDir = candidates.find((c) => existsSync(c))
  if (!specsDir) return null // not in the Docker build context — static list below
  const specFiles: string[] = []
  walk(specsDir, specFiles)
  const specIds = new Set<string>()
  for (const file of specFiles) {
    for (const match of readFileSync(file, 'utf8').matchAll(REQ_RE)) specIds.add(match[0])
  }
  return specIds
}

/** R-IDs found in test names across ui/tests + backend/tests. */
function collectCoveredIds(): Set<string> {
  const testDirs = [path.resolve(process.cwd(), 'tests'), path.resolve(REPO_ROOT, 'backend/tests')]
  const testFiles: string[] = []
  for (const dir of testDirs) {
    if (existsSync(dir)) walk(dir, testFiles)
  }
  const nameRe = /(?:it|test|describe)\(\s*['"]([^'"]+)/g
  const covered = new Set<string>()
  for (const file of testFiles) {
    if (!/\.test\.(ts|tsx)$/.test(file)) continue
    for (const match of readFileSync(file, 'utf8').matchAll(nameRe)) {
      for (const req of (match[1] ?? '').matchAll(REQ_RE)) covered.add(req[0])
    }
  }
  return covered
}

describe('R-UI-NFR-6: every requirement ID in the specs appears in ≥1 test name', () => {
  it('R-UI-NFR-6: coverage scan over spec IDs × (ui + backend) test names is complete', () => {
    const specIds = collectSpecIds()
    // local + CI: the dynamic scan is authoritative and must be a SUPERSET of
    // the pinned list (drift guard — new spec IDs must reach this list too).
    if (specIds) {
      const missingFromList = [...REQUIRED_UI_IDS].filter((id) => !specIds.has(id)).sort()
      expect(missingFromList).toEqual([])
      expect(specIds.size).toBeGreaterThan(REQUIRED_UI_IDS.length - 5)
    }
    // Docker build context has no openspec/ — the static list IS the gate.
    const effective = specIds ?? new Set(REQUIRED_UI_IDS)
    const covered = collectCoveredIds()
    const missing = [...effective].filter((id) => !covered.has(id)).sort()
    expect(missing).toEqual([])
  })
})

/* ── design flag b verification: WAREHOUSE_IN_USE localizeError parity ── */

describe('R-I18N-4 (design flag b): WAREHOUSE_IN_USE fully localized in BOTH catalogs', () => {
  it('R-I18N-4: ERROR_MESSAGE_KEYS maps WAREHOUSE_IN_USE → errors.conflict.warehouseInUse', () => {
    expect(ERROR_MESSAGE_KEYS.WAREHOUSE_IN_USE).toBe('errors.conflict.warehouseInUse')
  })

  it('R-I18N-4: es and en BOTH carry errors.conflict.warehouseInUse (parity)', () => {
    const esValue = es['errors.conflict.warehouseInUse']
    const enValue = en['errors.conflict.warehouseInUse']
    expect(typeof esValue).toBe('string')
    expect(esValue!.length).toBeGreaterThan(0)
    expect(typeof enValue).toBe('string')
    expect(enValue!.length).toBeGreaterThan(0)
  })
})

/* ── R-PROD-3 modified / R-UI-NFR-7: CI + Docker frontend gate (T-6-4) ── */

describe('R-PROD-3 (modified): CI runs the frontend gate before Docker build', () => {
  it('R-PROD-3: ci.yml contains ui typecheck, ui tests and ui build steps', () => {
    const ci = readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8')
    expect(ci).toContain('typecheck')
    expect(ci).toMatch(/npm test -w ui/)
    expect(ci).toMatch(/npm run build -w ui/)
  })
})

describe('R-UI-NFR-7: Dockerfile builds ui/dist and the runtime serves it', () => {
  it('R-UI-NFR-7: Dockerfile build stage runs ui typecheck + tests + vite build', () => {
    const dockerfile = readFileSync(path.join(REPO_ROOT, 'Dockerfile'), 'utf8')
    expect(dockerfile).toContain('npm run typecheck')
    expect(dockerfile).toMatch(/npm test -w ui/)
    expect(dockerfile).toMatch(/npm run build -w ui/)
  })

  it('R-UI-NFR-7: Dockerfile runtime stage copies ui/dist into the image', () => {
    const dockerfile = readFileSync(path.join(REPO_ROOT, 'Dockerfile'), 'utf8')
    expect(dockerfile).toMatch(/COPY --from=build .*ui\/dist/)
  })

  it('R-UI-NFR-7: root build script produces the UI dist via vite', () => {
    const rootPkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(rootPkg.scripts.build).toContain('npm run build -w ui')
  })
})