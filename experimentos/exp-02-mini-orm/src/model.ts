/**
 * Model factory (AD-4, AD-5): createModel(descriptor, db) returns a class whose
 * statics close over the injected connection and the descriptor. The ORM never
 * opens or closes connections (AD-5); queries go through the pure query builder
 * (identifiers ONLY from the descriptor, user values ONLY as bindings — R2).
 * Hydration copies null-prototype rows into fresh class instances via fromSql
 * (R11); no identity map — every query returns fresh instances (R11-S2).
 */

import type { DatabaseSync } from 'node:sqlite';

import { validateDescriptor } from './schema.ts';
import type { ModelDescriptor } from './schema.ts';
import { fromSql } from './coercion.ts';
import { buildSelect, buildInsert, buildUpdate, buildDelete } from './query-builder.ts';
import type { Criteria } from './query-builder.ts';

/** Instance side: dynamic column fields, indexed for TS strict mode, plus the
 *  instance API (R8): save() is update-only, delete() mirrors the static. */
export interface ModelInstance {
  [key: string]: unknown;
  save(): boolean;
  delete(): boolean;
}

/** Public static surface of the class returned by createModel. */
export interface ModelClass {
  new (): ModelInstance;
  find(criteria?: Criteria): ModelInstance[];
  findById(id: unknown): ModelInstance | null;
  create(data: Record<string, unknown>): ModelInstance;
  update(id: unknown, patch: Record<string, unknown>): ModelInstance | null;
  delete(id: unknown): boolean;
}

/** node:sqlite types changes as number|bigint; `> 0` is safe for both at
 *  runtime, but TS rejects mixed `number|bigint > number`, so narrow first. */
function hasChanges(result: { changes: number | bigint }): boolean {
  return typeof result.changes === 'bigint' ? result.changes > 0n : result.changes > 0;
}

export function createModel(descriptor: ModelDescriptor, db: DatabaseSync): ModelClass {
  validateDescriptor(descriptor);

  class Model {
    [key: string]: unknown;

    static find(criteria?: Criteria): ModelInstance[] {
      const { sql, bindings } = buildSelect(descriptor, criteria);
      const rows = db.prepare(sql).all(...bindings);
      return rows.map((row) => hydrate(row));
    }

    static findById(id: unknown): ModelInstance | null {
      if (id === undefined || id === null) {
        throw new Error(`findById requires a non-null id; received ${String(id)}`);
      }
      const { sql, bindings } = buildSelect(descriptor, {
        where: { [descriptor.primaryKey]: id },
      });
      const row = db.prepare(sql).get(...bindings);
      return row === undefined ? null : hydrate(row);
    }

    static create(data: Record<string, unknown>): ModelInstance {
      const { sql, bindings } = buildInsert(descriptor, data);
      const result = db.prepare(sql).run(...bindings);
      const created = Model.findById(result.lastInsertRowid);
      if (created === null) {
        throw new Error('create succeeded but the inserted row could not be read back');
      }
      return created;
    }

    static update(id: unknown, patch: Record<string, unknown>): ModelInstance | null {
      // AD-4: an empty patch is a no-op that returns the current row (R9-S1);
      // buildUpdate would reject it as invalid SQL, so never call it here.
      if (Object.keys(patch).length === 0) {
        return Model.findById(id);
      }
      const { sql, bindings } = buildUpdate(descriptor, id, patch);
      const result = db.prepare(sql).run(...bindings);
      if (!hasChanges(result)) return null;
      return Model.findById(id);
    }

    static delete(id: unknown): boolean {
      const { sql, bindings } = buildDelete(descriptor, id);
      const result = db.prepare(sql).run(...bindings);
      return hasChanges(result);
    }

    /** Update-only (D3, R8): the PK travels as a normal hydrated field and is
     *  read from this[primaryKey]; a missing PK throws (R8-S2) — save() NEVER
     *  upserts, create() is the only INSERT path (R8-S3). The patch is built
     *  from ALL descriptor columns except the PK (no dirty tracking — a
     *  documented simplification); extra non-descriptor properties are ignored
     *  (axiom 4). Delegates to the same update path as the static update, so an
     *  empty patch (single-column descriptor) is the AD-4 no-op. Returns true
     *  when a row was updated, false when the row no longer exists. */
    save(): boolean {
      const pk = requirePk(this, 'save()');
      const patch: Record<string, unknown> = {};
      for (const [column] of Object.entries(descriptor.columns)) {
        if (column !== descriptor.primaryKey) patch[column] = this[column];
      }
      return Model.update(pk, patch) !== null;
    }

    /** Mirrors the static delete (R8-S4): reads the PK from the instance; a
     *  missing PK throws (design addition, mirror of save() R8-S2). */
    delete(): boolean {
      const pk = requirePk(this, 'delete()');
      return Model.delete(pk);
    }
  }

  /** Reads the instance PK from the hydrated field; throws a descriptive error
   *  when it is missing/undefined (R8-S2 + design mirror for delete). */
  function requirePk(instance: ModelInstance, method: string): unknown {
    const pk = instance[descriptor.primaryKey];
    if (pk === undefined || pk === null) {
      throw new Error(
        `${method} requires the primary key "${descriptor.primaryKey}" to be set on the instance; received ${String(pk)}`,
      );
    }
    return pk;
  }

  /** Copies a raw (null-prototype) row into a fresh class instance via fromSql
   *  (R11-S1: real instance; R11-S2: new Model() per call, no identity map). */
  function hydrate(row: Record<string, unknown>): ModelInstance {
    const instance = new Model();
    for (const [column, type] of Object.entries(descriptor.columns)) {
      instance[column] = fromSql(row[column], type);
    }
    return instance;
  }

  return Model;
}