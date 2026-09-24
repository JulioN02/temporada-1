import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALL_PERMISSIONS, ROLES, ROLE_PERMISSIONS, type Role } from '../../src/permissions/registry.ts'

/** Reads the SQL seed file so the parity test asserts registry ≡ actual seeds. */
function readSeedSql(): string {
  const sqlPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../src/db/sql/001_rbac.sql',
  )
  return readFileSync(sqlPath, 'utf8')
}

/** Extracts seeded permission codes from `INSERT INTO permissions (code) VALUES (...)` — R-AUTH-7. */
function seededPermissionCodes(sql: string): string[] {
  const block = sql.match(/INSERT INTO permissions \(code\) VALUES\s*([\s\S]*?);/)
  assert.ok(block, 'permissions seed block must exist')
  const codes = [...block[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
  return codes
}

/** Extracts seeded role codes from `INSERT INTO roles (code, description) VALUES (...)` — R-AUTH-7. */
function seededRoleCodes(sql: string): string[] {
  const block = sql.match(/INSERT INTO roles \(code, description\) VALUES\s*([\s\S]*?);/)
  assert.ok(block, 'roles seed block must exist')
  // Each row is ('code', 'description') — capture the FIRST quoted token per row.
  const codes = [...block[1]!.matchAll(/\(\s*'([^']+)',/g)].map((m) => m[1]!)
  return codes
}

describe('permissions registry parity (T-1-2, R-AUTH-7)', () => {
  it('R-AUTH-7: registry permission set ⊆ SQL seeds', () => {
    const seeded = new Set(seededPermissionCodes(readSeedSql()))
    for (const permission of ALL_PERMISSIONS) {
      assert.ok(seeded.has(permission), `registry permission ${permission} missing from SQL seeds`)
    }
  })

  it('R-AUTH-7: SQL seeds ⊆ registry permission set', () => {
    const registry = new Set<string>(ALL_PERMISSIONS)
    for (const code of seededPermissionCodes(readSeedSql())) {
      assert.ok(registry.has(code), `SQL seed permission ${code} missing from registry`)
    }
  })

  it('R-AUTH-7: registry roles ≡ SQL seed roles (exactly the five)', () => {
    const registryRoles = Object.values(ROLES)
    const seeded = seededRoleCodes(readSeedSql())
    assert.deepEqual([...registryRoles].sort(), [...seeded].sort())
    assert.equal(registryRoles.length, 5)
    assert.deepEqual(registryRoles, ['admin', 'manager', 'operator', 'viewer', 'auditor'])
  })

  it('R-AUTH-7: permission codes are unique and total 19 (locked matrix)', () => {
    assert.equal(new Set(ALL_PERMISSIONS).size, ALL_PERMISSIONS.length)
    assert.equal(ALL_PERMISSIONS.length, 19)
  })

  it('R-AUTH-7: matrix matches spec §5 (per-role permission sets)', () => {
    const byRole = (role: Role): Set<string> => new Set(ROLE_PERMISSIONS[role])
    // admin: everything
    assert.deepEqual(byRole('admin'), new Set(ALL_PERMISSIONS))
    // manager: crm + orders + stock + jobs + notifications — NO auth/audit
    assert.ok(byRole('manager').has('stock:product_manage'))
    assert.ok(byRole('manager').has('jobs:job_retry'))
    assert.ok(!byRole('manager').has('auth:user_create'))
    assert.ok(!byRole('manager').has('audit:read'))
    // operator: crm + orders + stock adjust/read + notifications — NO product_manage/transfer/jobs
    assert.ok(byRole('operator').has('stock:stock_adjust'))
    assert.ok(!byRole('operator').has('stock:product_manage'))
    assert.ok(!byRole('operator').has('stock:stock_transfer'))
    assert.ok(!byRole('operator').has('jobs:job_read'))
    // viewer: read-only + notifications — nothing else
    assert.deepEqual(
      byRole('viewer'),
      new Set(['crm:customer_read', 'orders:order_read', 'stock:stock_read', 'notification:read', 'notification:update']),
    )
    assert.ok(!byRole('viewer').has('crm:customer_create'))
    // auditor: read-only + notifications + audit:read — no writes anywhere
    assert.ok(byRole('auditor').has('audit:read'))
    assert.ok(!byRole('auditor').has('crm:customer_create'))
    assert.ok(!byRole('auditor').has('orders:order_confirm'))
    assert.ok(!byRole('auditor').has('stock:stock_adjust'))
  })

  it('every permission code belongs to exactly one role of the five (union = all, no orphans)', () => {
    const covered = new Set<string>()
    for (const role of Object.values(ROLES)) {
      for (const permission of ROLE_PERMISSIONS[role as Role]) covered.add(permission as string)
    }
    assert.deepEqual([...covered].sort(), [...ALL_PERMISSIONS].sort())
  })
})