/**
 * Per-column-type behavior registry for user tables.
 *
 * Today the six behaviors below (SQL cast, parse, validate, format, and
 * compatibility-on-conversion) are each implemented as an independent
 * `switch (column.type)` in `validation.ts`, `sql.ts`, and `columns/service.ts`.
 * Adding a type means finding and updating every one of them by hand, and
 * missing one fails silently and differently depending which switch it was
 * (see each file's `default` branch, or lack of one). This module is the
 * single per-type definition those switches should eventually delegate to —
 * one object per type, one `Record` covering all of `COLUMN_TYPES`, so a
 * missing type is a compile error against the `Record` instead of a runtime
 * surprise three files later.
 *
 * Not yet wired up: `cell-format.ts` and `cell-render.tsx` still carry their
 * own type-specific logic, unchanged — see their own files for why.
 *
 * Pure module (no `@sim/db`, no Next.js) so it stays safe to import from
 * client code later, the same discipline `dates.ts` documents for itself.
 * That's also why `select`'s behavior delegates to `select-values.ts` (also
 * pure) rather than `validation.ts` (imports `@sim/db` for its unique-
 * constraint checks) — importing the latter here would taint this module or,
 * once `validation.ts` migrates to depend on this one, create a cycle.
 */

import type { COLUMN_TYPES } from '@/lib/table/constants'
import { formatDateCellDisplay, normalizeDateCellValue } from '@/lib/table/dates'
import {
  resolveSelectOptionId,
  selectValueToNames,
  splitMultiSelectInput,
} from '@/lib/table/select-values'
import type { ColumnDefinition, JsonValue, SelectOption } from '@/lib/table/types'

export type ParseResult<T> = { ok: true; value: T } | { ok: false }

/** The shape of a column a value is being checked against — not necessarily a full `ColumnDefinition` (no `name`) since callers assemble it from a pending change. */
export type TargetColumnConfig = Pick<
  ColumnDefinition,
  'type' | 'options' | 'multiple' | 'required'
>

/**
 * Everything one column type needs to answer about a value: how it sorts in
 * SQL, how a raw input becomes the stored primitive, whether a stored value
 * is shaped correctly, how it prints, and whether it survives converting to
 * (or from) another type.
 */
export interface ColumnTypeDefinition {
  /** Postgres cast for JSONB text extraction when filtering/sorting, or `null` to compare as text. */
  sqlCast: 'numeric' | 'timestamptz' | null
  /** Raw user/API/CSV input → the stored primitive, or `{ ok: false }` if it can't be parsed unambiguously. */
  parse(raw: JsonValue, column: ColumnDefinition): ParseResult<JsonValue>
  /** Error message if `value` (already coerced) doesn't match this type's stored shape, else `null`. */
  isValidValue(value: JsonValue, column: ColumnDefinition): string | null
  /** Stored primitive → plain display string. Not the richer grid rendering (chips, links) — just text. */
  format(value: JsonValue, column: ColumnDefinition): string
  /**
   * Would `value` still be valid if its column became `target`? Dispatched by
   * `target`'s type, not the value's current column — a type's own rules
   * never depend on where a value came from. Any source-specific translation
   * (e.g. a `select` id resolved to its option name) happens in the caller,
   * before this is called — see `selectValueForConversion`.
   */
  isCompatible(value: unknown, target: TargetColumnConfig): boolean
}

/** Set of valid option ids for a `select`/`multiselect` column. */
function selectOptionIds(options: SelectOption[]): Set<string> {
  return new Set(options.map((o) => o.id))
}

export const stringColumnType: ColumnTypeDefinition = {
  sqlCast: null,
  parse(raw) {
    if (typeof raw === 'string') return { ok: true, value: raw }
    if (typeof raw === 'number' || typeof raw === 'boolean') return { ok: true, value: String(raw) }
    return { ok: false }
  },
  isValidValue(value, column) {
    if (typeof value !== 'string') return `${column.name} must be string, got ${typeof value}`
    return null
  },
  format(value) {
    return typeof value === 'string' ? value : String(value)
  },
  isCompatible(value) {
    return typeof value !== 'object'
  },
}

export const numberColumnType: ColumnTypeDefinition = {
  sqlCast: 'numeric',
  parse(raw) {
    if (typeof raw === 'number') {
      return Number.isFinite(raw) ? { ok: true, value: raw } : { ok: false }
    }
    if (typeof raw === 'string' && raw.trim() !== '') {
      const parsed = Number(raw)
      return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false }
    }
    return { ok: false }
  },
  isValidValue(value, column) {
    if (typeof value !== 'number' || Number.isNaN(value)) return `${column.name} must be number`
    return null
  },
  format(value) {
    return String(value)
  },
  isCompatible(value) {
    if (typeof value === 'number') return Number.isFinite(value)
    if (typeof value === 'string') {
      const num = Number(value)
      return Number.isFinite(num) && value.trim() !== ''
    }
    return false
  },
}

export const booleanColumnType: ColumnTypeDefinition = {
  sqlCast: null,
  parse(raw) {
    if (typeof raw === 'boolean') return { ok: true, value: raw }
    if (typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase()
      if (normalized === 'true') return { ok: true, value: true }
      if (normalized === 'false') return { ok: true, value: false }
    }
    return { ok: false }
  },
  isValidValue(value, column) {
    if (typeof value !== 'boolean') return `${column.name} must be boolean`
    return null
  },
  format(value) {
    return String(value)
  },
  isCompatible(value) {
    if (typeof value === 'boolean') return true
    if (typeof value === 'string') return ['true', 'false', '1', '0'].includes(value.toLowerCase())
    if (typeof value === 'number') return value === 0 || value === 1
    return false
  },
}

export const dateColumnType: ColumnTypeDefinition = {
  sqlCast: 'timestamptz',
  parse(raw) {
    if (typeof raw === 'string') {
      const normalized = normalizeDateCellValue(raw)
      return normalized === null ? { ok: false } : { ok: true, value: normalized }
    }
    // Date instances and epoch numbers may still be out of the representable
    // range — guard `toISOString()`, which throws on an Invalid Date.
    const date = raw instanceof Date ? raw : typeof raw === 'number' ? new Date(raw) : null
    if (date && !Number.isNaN(date.getTime())) return { ok: true, value: date.toISOString() }
    return { ok: false }
  },
  isValidValue(value, column) {
    if (value instanceof Date) return null
    if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return null
    return `${column.name} must be valid date`
  },
  format(value) {
    return formatDateCellDisplay(typeof value === 'string' ? value : String(value))
  },
  isCompatible(value) {
    if (value instanceof Date) return !Number.isNaN(value.getTime())
    if (typeof value === 'string') return !Number.isNaN(Date.parse(value))
    return false
  },
}

export const jsonColumnType: ColumnTypeDefinition = {
  sqlCast: null,
  parse(raw) {
    return { ok: true, value: raw }
  },
  isValidValue(value, column) {
    try {
      JSON.stringify(value)
      return null
    } catch {
      return `${column.name} must be valid JSON`
    }
  },
  format(value) {
    return JSON.stringify(value)
  },
  isCompatible() {
    return true
  },
}

export const selectColumnType: ColumnTypeDefinition = {
  sqlCast: null,
  parse(raw, column) {
    const options = column.options ?? []
    if (column.multiple) {
      const parts = splitMultiSelectInput(raw)
      const ids: string[] = []
      for (const part of parts) {
        const id = resolveSelectOptionId(part, options)
        if (id !== null && !ids.includes(id)) ids.push(id)
      }
      return { ok: true, value: ids }
    }
    // Single: tolerate an array (e.g. right after a multiple→single toggle) by
    // resolving its first element so the value isn't dropped wholesale.
    const single = Array.isArray(raw) ? raw[0] : raw
    const id = single === undefined ? null : resolveSelectOptionId(single, options)
    return id !== null ? { ok: true, value: id } : { ok: false }
  },
  isValidValue(value, column) {
    const ids = selectOptionIds(column.options ?? [])
    if (column.multiple) {
      if (!Array.isArray(value)) return `${column.name} must be a list of options`
      if (!value.every((v) => typeof v === 'string' && ids.has(v))) {
        return `${column.name} must only contain defined options`
      }
      if (column.required && value.length === 0) return `Missing required field: ${column.name}`
      return null
    }
    if (typeof value !== 'string' || !ids.has(value)) {
      return `${column.name} must be one of the defined options`
    }
    return null
  },
  format(value, column) {
    const names = selectValueToNames(column, value)
    if (Array.isArray(names)) return names.join(', ')
    return names ?? ''
  },
  isCompatible(value, target) {
    const targetOptions = target.options ?? []
    const targetMultiple = !!target.multiple
    const targetRequired = !!target.required
    // A cleared select cell is written as '' — still convertible, unless the
    // target is required.
    if (value === '') return !targetRequired
    const parts = targetMultiple
      ? splitMultiSelectInput(value as JsonValue)
      : Array.isArray(value)
        ? value
        : [value]
    // A single-select target can't hold several options.
    if (!targetMultiple && parts.length > 1) return false
    return parts.every((v) => resolveSelectOptionId(v as JsonValue, targetOptions) !== null)
  },
}

/**
 * One definition per {@link COLUMN_TYPES} entry. Typed against the literal
 * union (not `Record<string, ...>`) so omitting or misspelling a type here is
 * a compile error, not a silent gap discovered at runtime.
 */
export const COLUMN_TYPE_REGISTRY: Record<(typeof COLUMN_TYPES)[number], ColumnTypeDefinition> = {
  string: stringColumnType,
  number: numberColumnType,
  boolean: booleanColumnType,
  date: dateColumnType,
  json: jsonColumnType,
  select: selectColumnType,
}

/** Looks up a column type's definition, or `undefined` for an unrecognized type string. */
export function getColumnType(type: string): ColumnTypeDefinition | undefined {
  return COLUMN_TYPE_REGISTRY[type as (typeof COLUMN_TYPES)[number]]
}

/** Convenience wrapper mirroring `validation.ts`'s `coerceValueToColumnType` — not yet called from there. */
export function parseColumnValue(raw: JsonValue, column: ColumnDefinition): ParseResult<JsonValue> {
  const definition = getColumnType(column.type)
  return definition ? definition.parse(raw, column) : { ok: false }
}

/** Convenience wrapper mirroring `validation.ts`'s per-case branch in `validateRowAgainstSchema` — not yet called from there. */
export function isValidColumnValue(value: JsonValue, column: ColumnDefinition): string | null {
  const definition = getColumnType(column.type)
  return definition
    ? definition.isValidValue(value, column)
    : `Unknown column type "${column.type}"`
}

/** Stored primitive → plain display string for `column`. New capability — no existing single call site to mirror (see the explanation of the gap this fills). */
export function formatColumnValue(value: JsonValue, column: ColumnDefinition): string {
  const definition = getColumnType(column.type)
  return definition ? definition.format(value, column) : String(value)
}

/** Convenience wrapper mirroring `columns/service.ts`'s `isValueCompatibleWithType` — not yet called from there. */
export function isValueCompatibleWithColumnType(
  value: unknown,
  target: TargetColumnConfig
): boolean {
  if (value === null || value === undefined) return true
  const definition = getColumnType(target.type)
  return definition ? definition.isCompatible(value, target) : false
}

/** Convenience wrapper mirroring `sql.ts`'s `jsonbCastForType` — not yet called from there. */
export function sqlCastForColumnType(type: string | undefined): 'numeric' | 'timestamptz' | null {
  if (!type) return null
  return getColumnType(type)?.sqlCast ?? null
}
