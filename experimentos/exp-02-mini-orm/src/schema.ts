/**
 * Schema descriptor — single source of truth for a model (AD-1, axiom 4).
 * The SQL storage type is NOT duplicated here; it is derived from the JS type
 * via the coercion map (src/coercion.ts, group 4).
 */

export const COLUMN_JS_TYPES = ['int', 'float', 'string', 'bool', 'date'] as const;
export type ColumnJsType = (typeof COLUMN_JS_TYPES)[number];

export interface ModelDescriptor {
  table: string;
  primaryKey: string;
  columns: Record<string, ColumnJsType>;
}

/**
 * Fail-fast runtime validation of a descriptor (AD-1). Throws a descriptive
 * error for programming errors; never guesses or repairs the descriptor.
 */
export function validateDescriptor(descriptor: ModelDescriptor): void {
  if (typeof descriptor.table !== 'string' || descriptor.table.trim() === '') {
    throw new Error('ModelDescriptor.table must be a non-empty string');
  }
  if (typeof descriptor.primaryKey !== 'string' || descriptor.primaryKey.trim() === '') {
    throw new Error('ModelDescriptor.primaryKey must be a non-empty string');
  }
  if (Object.keys(descriptor.columns).length === 0) {
    throw new Error('ModelDescriptor.columns must not be empty');
  }
  if (!(descriptor.primaryKey in descriptor.columns)) {
    throw new Error(`primaryKey "${descriptor.primaryKey}" is not a declared column`);
  }
  for (const [name, type] of Object.entries(descriptor.columns)) {
    if (!COLUMN_JS_TYPES.includes(type)) {
      throw new Error(
        `column "${name}" has invalid type "${String(type)}"; expected one of: ${COLUMN_JS_TYPES.join(', ')}`,
      );
    }
  }
}

/**
 * Structural enforcement point for R2 (identifiers only from the descriptor):
 * rejects any column name not declared in the descriptor (R3-S4 base).
 */
export function assertKnownColumn(descriptor: ModelDescriptor, column: string): void {
  if (!(column in descriptor.columns)) {
    const known = Object.keys(descriptor.columns).join(', ');
    throw new Error(`unknown column "${column}"; expected one of: ${known}`);
  }
}