/**
 * Query builder (AD-3): pure functions that turn (descriptor + user input)
 * into { sql, bindings }.
 *
 * Structural enforcement of R2: identifiers (table/columns/pk) come ONLY from
 * descriptor lookups via assertKnownColumn — never raw from user input.
 * User values (criteria/data/patch/ids/limit) appear ONLY as `?` bindings,
 * coerced to storage format via toSql (AD-2) in fixed order.
 */

import { assertKnownColumn } from './schema.ts';
import type { ModelDescriptor, ColumnJsType } from './schema.ts';
import { toSql } from './coercion.ts';
import type { SqlBindValue } from './coercion.ts';

export interface Criteria {
  where?: Record<string, unknown>;
  orderBy?: string;
  limit?: number;
}

export interface BuildQuery {
  sql: string;
  bindings: SqlBindValue[];
}

/** Returns the declared type of a column, throwing a descriptive error for
 *  unknown columns (R3-S4). Guarantees identifiers come from the descriptor. */
function columnTypeOf(descriptor: ModelDescriptor, column: string): ColumnJsType {
  assertKnownColumn(descriptor, column);
  const type = descriptor.columns[column];
  if (type === undefined) {
    throw new Error(`unknown column "${column}"`); // unreachable after assertKnownColumn
  }
  return type;
}

/**
 * SELECT * FROM {table} [WHERE col = ? AND col = ?] [ORDER BY col ASC] [LIMIT ?].
 * Bindings order: where values (key insertion order), then limit.
 */
export function buildSelect(descriptor: ModelDescriptor, criteria: Criteria = {}): BuildQuery {
  const bindings: SqlBindValue[] = [];
  const clauses: string[] = [];

  if (criteria.where !== undefined) {
    for (const [column, value] of Object.entries(criteria.where)) {
      clauses.push(`${column} = ?`);
      bindings.push(toSql(value, columnTypeOf(descriptor, column)));
    }
  }

  let sql = `SELECT * FROM ${descriptor.table}`;
  if (clauses.length > 0) sql += ` WHERE ${clauses.join(' AND ')}`;
  if (criteria.orderBy !== undefined) {
    columnTypeOf(descriptor, criteria.orderBy);
    sql += ` ORDER BY ${criteria.orderBy} ASC`;
  }
  if (criteria.limit !== undefined) {
    sql += ' LIMIT ?';
    bindings.push(criteria.limit);
  }

  return { sql, bindings };
}

/**
 * INSERT INTO {table} (c1, c2) VALUES (?, ?). Only keys present in data that
 * are known columns; the pk is included only if passed (DB decides otherwise).
 */
export function buildInsert(descriptor: ModelDescriptor, data: Record<string, unknown>): BuildQuery {
  const columns: string[] = [];
  const bindings: SqlBindValue[] = [];

  for (const [column, value] of Object.entries(data)) {
    columns.push(column);
    bindings.push(toSql(value, columnTypeOf(descriptor, column)));
  }

  if (columns.length === 0) {
    throw new Error('insert data must not be empty');
  }

  const placeholders = columns.map(() => '?').join(', ');
  const sql = `INSERT INTO ${descriptor.table} (${columns.join(', ')}) VALUES (${placeholders})`;
  return { sql, bindings };
}

/**
 * UPDATE {table} SET c1 = ?, c2 = ? WHERE {pk} = ?.
 * Bindings: patch values (key insertion order), then id LAST (fixed order).
 * Empty patch is a no-op handled by the model layer (AD-4); here it throws
 * because it would generate invalid SQL.
 */
export function buildUpdate(
  descriptor: ModelDescriptor,
  id: unknown,
  patch: Record<string, unknown>,
): BuildQuery {
  const assignments: string[] = [];
  const bindings: SqlBindValue[] = [];

  for (const [column, value] of Object.entries(patch)) {
    assignments.push(`${column} = ?`);
    bindings.push(toSql(value, columnTypeOf(descriptor, column)));
  }

  if (assignments.length === 0) {
    throw new Error('update patch must not be empty');
  }

  const pkType = columnTypeOf(descriptor, descriptor.primaryKey);
  const sql = `UPDATE ${descriptor.table} SET ${assignments.join(', ')} WHERE ${descriptor.primaryKey} = ?`;
  bindings.push(toSql(id, pkType)); // id bound LAST
  return { sql, bindings };
}

/** DELETE FROM {table} WHERE {pk} = ?. The pk column name comes from the descriptor. */
export function buildDelete(descriptor: ModelDescriptor, id: unknown): BuildQuery {
  const pkType = columnTypeOf(descriptor, descriptor.primaryKey);
  const sql = `DELETE FROM ${descriptor.table} WHERE ${descriptor.primaryKey} = ?`;
  return { sql, bindings: [toSql(id, pkType)] };
}