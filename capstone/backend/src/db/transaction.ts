import type { Pool, PoolClient } from 'pg'

/**
 * Runs `fn` inside a single database transaction (BEGIN/COMMIT/ROLLBACK).
 * The client is released back to the pool in all paths.
 */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}