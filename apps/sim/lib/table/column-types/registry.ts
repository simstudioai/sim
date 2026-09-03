/**
 * The column-type registry — one entry per table column type.
 *
 * Client-safe: this module and everything it imports stay free of `@sim/db`,
 * `drizzle-orm`, and `next/server`, so the tables grid can import it directly.
 * The server-only half (retype cell migrations) lives in `registry.server.ts`.
 *
 * ## Adding a column type
 *
 * 1. Add its id to {@link ColumnType} in `types.ts`.
 * 2. Write `column-types/<id>.ts` exporting a `ColumnTypeDefinition`.
 * 3. Add it to `COLUMN_TYPE_REGISTRY` below.
 *
 * Step 3 is not optional and cannot be forgotten: the `Record<ColumnType, …>`
 * annotation makes step 1 a **compile error** until the entry exists, and the
 * `ColumnTypeDefinition` interface then makes it an error until every field is
 * filled in. That is the whole point of this file — adding a type used to mean
 * remembering ~40 scattered `switch` arms, each of which failed silently when
 * missed.
 */

import { booleanColumnType } from '@/lib/table/column-types/boolean'
import { currencyColumnType } from '@/lib/table/column-types/currency'
import { dateColumnType } from '@/lib/table/column-types/date'
import { jsonColumnType } from '@/lib/table/column-types/json'
import { numberColumnType } from '@/lib/table/column-types/number'
import { referenceColumnType } from '@/lib/table/column-types/reference'
import {
  MULTI_SELECT_OPERATORS,
  MULTI_SELECT_OPS,
  SINGLE_SELECT_OPERATORS,
  SINGLE_SELECT_OPS,
  selectColumnType,
} from '@/lib/table/column-types/select'
import { stringColumnType } from '@/lib/table/column-types/string'
import { ttlColumnType } from '@/lib/table/column-types/ttl'
import type { ColumnType, ColumnTypeDefinition } from '@/lib/table/column-types/types'
import { COLUMN_TYPES, TYPE_SPECIFIC_COLUMN_KEYS } from '@/lib/table/column-types/types'
import type { ColumnDefinition, JsonValue } from '@/lib/table/types'

export { COLUMN_TYPES }
export { MULTI_SELECT_OPERATORS, MULTI_SELECT_OPS, SINGLE_SELECT_OPERATORS, SINGLE_SELECT_OPS }

/**
 * Every column type, keyed by id. The annotation is the completeness gate —
 * see the module doc.
 */
export const COLUMN_TYPE_REGISTRY: Record<ColumnType, ColumnTypeDefinition> = {
  string: stringColumnType,
  number: numberColumnType,
  boolean: booleanColumnType,
  date: dateColumnType,
  ttl: ttlColumnType,
  json: jsonColumnType,
  select: selectColumnType,
  reference: referenceColumnType,
  currency: currencyColumnType,
}

/** Every definition, in the same order as {@link COLUMN_TYPES}. */
export const ALL_COLUMN_TYPES: readonly ColumnTypeDefinition[] = COLUMN_TYPES.map(
  (id) => COLUMN_TYPE_REGISTRY[id]
)

/** Whether `value` is a known column type. */
export function isColumnType(value: unknown): value is ColumnType {
  // `in` would also match inherited keys, so `'toString'` would type-guard as a
  // column type and then resolve to `Function.prototype.toString`.
  return typeof value === 'string' && Object.hasOwn(COLUMN_TYPE_REGISTRY, value)
}

/**
 * The definition for a column's type. Falls back to `string` for a column whose
 * declared type is not (or is no longer) a known one, so a malformed schema
 * renders as text instead of throwing mid-render.
 */
export function columnTypeOf(column: Pick<ColumnDefinition, 'type'>): ColumnTypeDefinition {
  return COLUMN_TYPE_REGISTRY[column.type] ?? stringColumnType
}

/** The definition for a type id, or `string`'s when the id is unknown. */
export function columnTypeById(type: string | undefined): ColumnTypeDefinition {
  return (isColumnType(type) && COLUMN_TYPE_REGISTRY[type]) || stringColumnType
}

/**
 * Whether an existing cell survives a conversion **to** `target`'s type.
 *
 * Falls back to "whatever the type's `coerce` accepts". Only `select`
 * overrides, because its rules (a cleared `''` against `required`, and single
 * vs multi cardinality) are about the column, not the value.
 */
export function isValueCompatible(value: unknown, target: ColumnDefinition): boolean {
  const definition = columnTypeOf(target)
  if (definition.isCompatibleWith) return definition.isCompatibleWith(value, target)
  return definition.coerce(value as JsonValue, target).ok
}

/** Applies source-owned normalization before a value is converted to another type. */
export function valueForTypeConversion(
  value: JsonValue,
  source: ColumnDefinition,
  target: ColumnDefinition
): JsonValue {
  const normalized = columnTypeOf(source).valueForConversion?.(value, target)
  return normalized === undefined ? value : normalized
}

/** This type's own metadata errors; types carrying no metadata report none. */
export function validateTypeMetadata(column: ColumnDefinition): string[] {
  return columnTypeOf(column).validateDefinition?.(column) ?? []
}

/**
 * A column's type-specific metadata, as a spreadable object.
 *
 * Callers that copy a column — the API response serializer, the undo snapshot —
 * used to name type-specific keys by hand, so a new type's metadata was stored
 * but silently dropped on the way out. Reading the key list keeps them zero-edit.
 */
export function typeMetadataOf(column: ColumnDefinition): Partial<ColumnDefinition> {
  const metadata: Partial<ColumnDefinition> = {}
  for (const key of TYPE_SPECIFIC_COLUMN_KEYS) {
    if (column[key] !== undefined) Object.assign(metadata, { [key]: column[key] })
  }
  return metadata
}

/** Wire operators a column accepts, or `null` for "all operators". */
export function filterOperatorsFor(column: ColumnDefinition): ReadonlySet<string> | null {
  return columnTypeOf(column).filterOperatorsFor?.(column) ?? null
}

/** Schema-level cardinality errors declared by column type definitions. */
export function validateColumnTypeLimits(columns: readonly ColumnDefinition[]): string[] {
  const errors: string[] = []
  for (const definition of ALL_COLUMN_TYPES) {
    if (definition.maxPerTable === undefined) continue
    if (wouldExceedColumnTypeLimit(columns, definition.id)) {
      errors.push(`A table can have at most ${definition.maxPerTable} ${definition.label} column`)
    }
  }
  return errors
}

/** Whether adding columns of a type would exceed its registry-declared table limit. */
export function wouldExceedColumnTypeLimit(
  columns: readonly ColumnDefinition[],
  type: ColumnType,
  additionalColumns = 0
): boolean {
  const definition = COLUMN_TYPE_REGISTRY[type]
  if (definition.maxPerTable === undefined) return false

  const count = columns.reduce(
    (total, column) => total + (column.type === type ? 1 : 0),
    additionalColumns
  )
  return count > definition.maxPerTable
}
