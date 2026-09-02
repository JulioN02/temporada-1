/**
 * Bidirectional coercion (AD-2, R10): JS values <-> SQL storage values,
 * driven exclusively by the declared column JS type (never guessed from data).
 * Storage types are derived here, not duplicated in the descriptor (axiom 4).
 *
 * toSql: JS -> bind value (bool coerced to 0/1 BEFORE bind because
 *        node:sqlite rejects JS booleans; date -> ISO-8601 UTC TEXT).
 * fromSql: raw row value -> JS value (strict: never guesses, opposite face of R1-S2).
 */

import type { ColumnJsType } from './schema.ts';

/** Value types accepted by node:sqlite as bound parameters. Booleans are NOT
 *  included: they MUST be coerced via toSql before binding. */
export type SqlBindValue = null | number | bigint | string | Uint8Array;

function describeValue(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return typeof value;
}

function cannotStore(type: ColumnJsType, value: unknown): Error {
  return new Error(`column of type "${type}" cannot store value ${describeValue(value)}`);
}

function cannotRead(type: ColumnJsType, value: unknown): Error {
  return new Error(`column of type "${type}" cannot read value ${describeValue(value)}`);
}

/**
 * JS -> storage value, fail-fast on programming errors (invalid input throws a
 * descriptive error; null/undefined -> SQL NULL for any type).
 */
export function toSql(value: unknown, type: ColumnJsType): SqlBindValue {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'int':
    case 'float':
      if (typeof value !== 'number') throw cannotStore(type, value);
      return value;
    case 'string':
      if (typeof value !== 'string') throw cannotStore(type, value);
      return value;
    case 'bool':
      if (typeof value !== 'boolean') throw cannotStore(type, value);
      return value ? 1 : 0;
    case 'date':
      if (!(value instanceof Date)) throw cannotStore(type, value);
      if (Number.isNaN(value.getTime())) throw cannotStore(type, value);
      return value.toISOString();
  }
}

/**
 * Storage value -> JS value, strict (never guesses types — opposite face of
 * R1-S2). null -> null; bool accepts ONLY 0/1; int/float never Number(value);
 * date parses ISO-8601 strings with a NaN check.
 */
export function fromSql(value: unknown, type: ColumnJsType): unknown {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'int':
    case 'float':
      if (typeof value === 'bigint') return Number(value);
      if (typeof value !== 'number') throw cannotRead(type, value);
      return value;
    case 'string':
      if (typeof value !== 'string') throw cannotRead(type, value);
      return value;
    case 'bool':
      if (value === 0) return false;
      if (value === 1) return true;
      throw cannotRead(type, value);
    case 'date': {
      if (typeof value !== 'string') throw cannotRead(type, value);
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) throw cannotRead(type, value);
      return date;
    }
  }
}