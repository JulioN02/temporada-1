import 'dotenv/config'
import { Client } from 'pg'
import bcrypt from 'bcryptjs'

/**
 * Dev/demo seed (T-7-2 appliance demo; design tree scripts/seed.ts).
 *
 * Creates one user per role with a KNOWN dev password. DEMO ONLY — never run
 * in production (the runbook creates real users via POST /api/users). The
 * API has no self-registration (R-AUTH-1), so a fresh appliance needs this
 * or a manual admin creation to log in.
 *
 * Usage: node backend/scripts/seed.ts  (DATABASE_URL or default localhost)
 */
const DEFAULT_DATABASE_URL = 'postgres://postgres:postgres@localhost:55437/bop'

interface SeedUser {
  username: string
  email: string
  password: string
  role: string
}

const SEED_USERS: SeedUser[] = [
  { username: 'admin', email: 'admin@seed.local', password: 'AdminPass123', role: 'admin' },
  { username: 'manager', email: 'manager@seed.local', password: 'ManagerPass123', role: 'manager' },
  { username: 'operator', email: 'operator@seed.local', password: 'OperatorPass123', role: 'operator' },
  { username: 'viewer', email: 'viewer@seed.local', password: 'ViewerPass123', role: 'viewer' },
  { username: 'auditor', email: 'auditor@seed.local', password: 'AuditorPass123', role: 'auditor' },
]

async function main(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL })
  await client.connect()
  try {
    let created = 0
    for (const user of SEED_USERS) {
      const { rows } = await client.query('SELECT 1 FROM users WHERE username = $1', [user.username])
      if (rows.length > 0) continue // idempotent
      const hash = await bcrypt.hash(user.password, 10)
      const inserted = await client.query(
        `INSERT INTO users (username, full_name, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
        [user.username, user.role, user.email, hash],
      )
      await client.query(
        `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2`,
        [inserted.rows[0]!.id, user.role],
      )
      created += 1
      console.log(`Seeded ${user.username} (${user.role})`)
    }
    console.log(`Seed complete (${created} created, ${SEED_USERS.length - created} already present)`)
  } finally {
    await client.end()
  }
}

main().catch((err: unknown) => {
  console.error('Seed failed:', err)
  process.exit(1)
})