/**
 * Shared test fixtures (AD-5): a fresh `:memory:` DatabaseSync per test with
 * raw DDL visible in the test, plus the model class bound to it.
 * This file is NOT a test file itself (no .test.ts suffix) — it exports
 * fixture functions used by test files.
 */

import { DatabaseSync } from 'node:sqlite';
import type { TestContext } from 'node:test';

import { createModel } from '../src/model.ts';
import type { ModelClass } from '../src/model.ts';
import type { ModelDescriptor } from '../src/schema.ts';

export const userDescriptor = {
  table: 'users',
  primaryKey: 'id',
  columns: {
    id: 'int',
    name: 'string',
    email: 'string',
    age: 'int',
    active: 'bool',
    height: 'float',
    createdAt: 'date',
    note: 'string',
  },
} as const satisfies ModelDescriptor;

/** Raw DDL, visible in the fixture: storage semantics live here (axiom 3). */
export const USER_DDL = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT,
    age INTEGER,
    active INTEGER NOT NULL DEFAULT 0,
    height REAL,
    createdAt TEXT,
    note TEXT
  );
`;

export interface UserFixture {
  db: DatabaseSync;
  User: ModelClass;
}

export function setupUserFixture(t: TestContext, ddl: string = USER_DDL): UserFixture {
  const db = new DatabaseSync(':memory:');
  db.exec(ddl);
  t.after(() => db.close());
  const User = createModel(userDescriptor, db);
  return { db, User };
}

/**
 * Dedicated fixture for R9-S1 (not-found contract): declares a column named `x`
 * so find({where:{x:1}}) returns [] instead of hitting the unknown-column throw
 * of R3-S4. `x` is 'int' so the numeric value 1 binds without a coercion error
 * (a 'string' column would reject the number 1, see AD-2).
 */
export const xDescriptor = {
  table: 'things',
  primaryKey: 'id',
  columns: { id: 'int', x: 'int' },
} as const satisfies ModelDescriptor;

export const THINGS_DDL = `
  CREATE TABLE things (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    x INTEGER
  );
`;

export function setupThingsFixture(t: TestContext): { db: DatabaseSync; Thing: ModelClass } {
  const db = new DatabaseSync(':memory:');
  db.exec(THINGS_DDL);
  t.after(() => db.close());
  const Thing = createModel(xDescriptor, db);
  return { db, Thing };
}