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
import { durationColumnType } from '@/lib/table/column-types/duration'
import { emailColumnType } from '@/lib/table/column-types/email'
import { jsonColumnType } from '@/lib/table/column-types/json'
import { numberColumnType } from '@/lib/table/column-types/number'
import { percentColumnType } from '@/lib/table/column-types/percent'
import { phoneColumnType } from '@/lib/table/column-types/phone'
import {
  MULTI_SELECT_OPERATORS,
  SINGLE_SELECT_OPERATORS,
  selectColumnType,
} from '@/lib/table/column-types/select'
import { stringColumnType } from '@/lib/table/column-types/string'
import type {
  ColumnType,
  ColumnTypeDefinition,
  TypeSpecificColumnKey,
} from '@/lib/table/column-types/types'
import { COLUMN_TYPES, TYPE_SPECIFIC_COLUMN_KEYS } from '@/lib/table/column-types/types'
import { urlColumnType } from '@/lib/table/column-types/url'
import type { ColumnDefinition, JsonValue } from '@/lib/table/types'

export { COLUMN_TYPES }
export { MULTI_SELECT_OPERATORS, SINGLE_SELECT_OPERATORS }

/**
 * Every column type, keyed by id. The annotation is the completeness gate —
 * see the module doc.
 */
export const COLUMN_TYPE_REGISTRY: Record<ColumnType, ColumnTypeDefinition> = {
  string: stringColumnType,
  number: numberColumnType,
  boolean: booleanColumnType,
  date: dateColumnType,
  json: jsonColumnType,
  select: selectColumnType,
  currency: currencyColumnType,
  percent: percentColumnType,
  email: emailColumnType,
  phone: phoneColumnType,
  url: urlColumnType,
  duration: durationColumnType,
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

/** This type's own metadata errors; types carrying no metadata report none. */
export function validateTypeMetadata(column: ColumnDefinition): string[] {
  return columnTypeOf(column).validateDefinition?.(column) ?? []
}

/**
 * A column's type-specific metadata, as a spreadable object.
 *
 * Callers that copy a column — the API response serializer, the undo snapshot —
 * used to name `options`/`multiple`/`currencyCode` by hand, so a new type's
 * metadata was stored but silently dropped on the way out. Reading the key list
 * keeps them zero-edit.
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

/**
 * Metadata key → the type that owns it. Built once from `ownedMetadata`, which
 * is already the declaration every type makes; deriving the reverse index here
 * is what lets the routes ask "may this column carry this key?" without naming
 * a single key themselves.
 */
const METADATA_KEY_OWNER = new Map<TypeSpecificColumnKey, ColumnTypeDefinition>()
for (const definition of Object.values(COLUMN_TYPE_REGISTRY)) {
  for (const key of definition.ownedMetadata) {
    METADATA_KEY_OWNER.set(key, definition)
  }
}

/** The column type that owns a type-specific metadata key. */
export function ownerOfMetadataKey(key: TypeSpecificColumnKey): ColumnTypeDefinition | undefined {
  return METADATA_KEY_OWNER.get(key)
}

/**
 * The type-specific metadata keys present in an update payload, split by which
 * writer handles them.
 *
 * `generic` goes to `updateColumnMetadata` (schema write, plus the type's
 * `migrateCellsForMetadata` when it declares one); `dedicated` is a key whose
 * owner keeps its own writer — today only `select`'s `options` / `multiple`.
 * Callers branch on which set is non-empty instead of testing key names.
 */
export function metadataKeysIn(updates: Partial<ColumnDefinition>): {
  generic: TypeSpecificColumnKey[]
  dedicated: TypeSpecificColumnKey[]
} {
  const generic: TypeSpecificColumnKey[] = []
  const dedicated: TypeSpecificColumnKey[] = []
  for (const key of TYPE_SPECIFIC_COLUMN_KEYS) {
    if (updates[key] === undefined) continue
    const owner = METADATA_KEY_OWNER.get(key)
    const handled = owner?.genericMetadataUpdate ?? owner?.ownedMetadata ?? []
    ;(handled.includes(key) ? generic : dedicated).push(key)
  }
  return { generic, dedicated }
}

/** Whether a column of `type` may carry `key`. */
export function typeOwnsMetadataKey(type: string | undefined, key: TypeSpecificColumnKey): boolean {
  return columnTypeById(type).ownedMetadata.includes(key)
}

/**
 * The named metadata keys from an update payload, as a spreadable object.
 *
 * Skips keys the payload does not carry, so spreading the result never
 * introduces an explicit `undefined` — which would otherwise read as "clear
 * this key" to `filterUndefined` further down the write path.
 */
export function pickMetadata(
  updates: Partial<ColumnDefinition>,
  keys: readonly TypeSpecificColumnKey[]
): Partial<ColumnDefinition> {
  const picked: Partial<ColumnDefinition> = {}
  for (const key of keys) {
    if (updates[key] !== undefined) Object.assign(picked, { [key]: updates[key] })
  }
  return picked
}
