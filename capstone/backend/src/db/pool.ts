import { Pool } from 'pg'
import type { PoolClient } from 'pg'

/**
 * A queryable unit: either the shared pool or a transaction client.
 * Repositories accept `Db` so the same code works inside and outside
 * transactions (see src/db/transaction.ts).
 */
export type Db = Pool | PoolClient

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 10 })
}