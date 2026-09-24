import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Production contract scans (T-7-1..T-7-8). These are FAST static contract
 * tests that keep CI deterministic; the REAL docker build / compose up /
 * container runs are executed in the batch evidence (docs/output-it7.txt)
 * and in the CI workflow itself (R-PROD-1/2 scenarios).
 */

const CAPSTONE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function read(rel: string): string {
  return readFileSync(path.join(CAPSTONE, rel), 'utf8')
}

describe('R-PROD-1 Dockerfile (T-7-1)', () => {
  it('R-PROD-1: multi-stage Dockerfile — build and runtime stages, non-root, HEALTHCHECK, EXPOSE 3000', () => {
    const dockerfile = read('Dockerfile')
    assert.match(dockerfile, /FROM\s+node:22-alpine\s+AS\s+build/, 'build stage')
    assert.match(dockerfile, /FROM\s+node:22-alpine\s+AS\s+runtime/, 'runtime stage')
    assert.match(dockerfile, /USER\s+node/, 'non-root user (R-PROD-1 scenario: id -u != 0)')
    assert.match(dockerfile, /HEALTHCHECK/, 'HEALTHCHECK declared')
    assert.match(dockerfile, /\/api\/health/, 'HEALTHCHECK hits /api/health (R-OBS-1)')
    assert.match(dockerfile, /EXPOSE\s+3000/, 'API port exposed')
    assert.match(dockerfile, /npm\s+ci\s+--omit=dev/, 'runtime installs production deps only')
    assert.match(dockerfile, /COPY\s+--from=build/, 'runtime copies artifacts from build stage')
  })
})

describe('R-PROD-2 appliance compose (T-7-2)', () => {
  it('R-PROD-2: compose defines db, migrate, api, worker, mailpit with the boot-order contract', () => {
    const compose = read('docker-compose.yml')
    for (const service of ['db:', 'migrate:', 'api:', 'worker:', 'mailpit:']) {
      assert.ok(compose.includes(service), `missing service: ${service}`)
    }
    assert.match(compose, /pg_isready/, 'db healthcheck')
    assert.match(compose, /service_healthy/, 'migrate waits for healthy db')
    assert.match(compose, /service_completed_successfully/, 'api/worker wait for completed migrate')
    assert.match(compose, /3000:3000/, 'api reachable on localhost:3000')
    assert.match(compose, /db-data:/, 'postgres data volume')
    assert.match(compose, /worker\.ts/, 'worker runs the worker entrypoint')
  })

  it('R-PROD-2: api and worker share the same image (build from the repo Dockerfile)', () => {
    const compose = read('docker-compose.yml')
    assert.match(compose, /build:\s*\n\s*context: \./, 'services build from the repo Dockerfile')
  })
})

describe('R-PROD-3 CI pipeline (T-7-3)', () => {
  it('R-PROD-3: ci.yml runs install → test-db migrate → tsc → node --test → docker build → GHCR publish', () => {
    assert.ok(existsSync(path.join(CAPSTONE, '.github/workflows/ci.yml')), 'ci.yml exists')
    const ci = read('.github/workflows/ci.yml')
    assert.match(ci, /on:/, 'workflow triggers')
    assert.match(ci, /pull_request/, 'runs on PRs')
    assert.match(ci, /npm\s+ci/, 'install step')
    assert.match(ci, /--db=test/, 'test-db migrate step')
    assert.match(ci, /tsc\s+--noEmit|typecheck/, 'typecheck step')
    assert.match(ci, /node\s+--test|npm\s+test/, 'test suite step')
    assert.match(ci, /docker\s+build/, 'docker build step')
    assert.match(ci, /ghcr\.io/, 'publishes to GHCR')
    assert.match(ci, /secrets\.GITHUB_TOKEN/, 'registry auth via GitHub token, never inline secrets')
  })
})

describe('R-PROD-4 CD + Oracle runbook (T-7-4)', () => {
  it('R-PROD-4: cd.yml publishes GHCR on v* tags or manual dispatch', () => {
    assert.ok(existsSync(path.join(CAPSTONE, '.github/workflows/cd.yml')), 'cd.yml exists')
    const cd = read('.github/workflows/cd.yml')
    assert.match(cd, /v\*/, 'tag trigger v*')
    assert.match(cd, /ghcr\.io/, 'publishes to GHCR')
  })

  it('R-PROD-4: runbook has exact commands: image pull, env setup, compose up, backup, rollback', () => {
    assert.ok(existsSync(path.join(CAPSTONE, 'docs/deploy-oracle.md')), 'docs/deploy-oracle.md exists')
    const runbook = read('docs/deploy-oracle.md')
    assert.match(runbook, /docker\s+pull\s+ghcr\.io/, 'image pull command')
    assert.match(runbook, /JWT_SECRET/, 'secret setup documented (blank values)')
    assert.match(runbook, /docker\s+compose\s+up/, 'compose up command')
    assert.match(runbook, /pg_dump/, 'backup procedure')
    assert.match(runbook, /rollback/i, 'rollback procedure')
  })
})

describe('R-PROD-6 evidence per iteration (T-7-7)', () => {
  it('R-PROD-6: docs/output-it1..7.txt exist with suite counts and requirement IDs', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      const doc = read(`docs/output-it${n}.txt`)
      assert.match(doc, new RegExp(`Evidence it${n}`), `output-it${n}.txt has an evidence section`)
      assert.match(doc, /tests, \d+ passed/, 'suite counts present')
      assert.match(doc, /Requirement IDs covered/, 'requirement ID list present')
    }
  })
})

describe('R-PROD-8 repo naming + evidence dashboard (T-7-7/T-7-8)', () => {
  it('R-PROD-8: root package name and README carry the business-operations-platform name', () => {
    const rootPkg = JSON.parse(read('package.json')) as { name: string }
    assert.equal(rootPkg.name, 'business-operations-platform')
    assert.match(read('README.md'), /business-operations-platform/)
  })

  it('R-PROD-8: dashboard lists iterations 1-7 with relative evidence links, zero external assets', () => {
    const dashboard = read('docs/evidence/index.html')
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      assert.match(dashboard, new RegExp(`[Ii]teration\\s*${n}|it${n}`, 'm'), `dashboard mentions iteration ${n}`)
      assert.ok(
        dashboard.includes(`output-it${n}.txt`),
        `dashboard links output-it${n}.txt (relative)`,
      )
    }
    // dashboard-pages pattern: no CDN, no absolute asset URLs.
    const external = dashboard.match(/https?:\/\/[^"'\s]+/g) ?? []
    assert.deepEqual(external, [], 'dashboard must be offline-ready (relative paths only)')
  })
})