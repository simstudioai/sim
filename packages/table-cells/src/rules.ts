/**
 * What each table column type stores: how a written value coerces to its cell, what a stored cell
 * must hold, what a machine write that cannot fail keeps of a value `coerce` refused, and how two
 * cells compare for a unique column. The server's column-type registry spreads each entry into its
 * definition, and the CLI checks a workspace directory's rows with the same entries, so a row the
 * offline check accepts is one the write accepts.
 */
import { parseCurrencyInput } from './currency'
import { normalizeDateCellValue } from './dates'
import {
  optionIds,
  resolveSelectCellValue,
  resolveSelectOptionId,
  splitMultiSelectInput,
} from './select'
import {
  isTtlTimestamp,
  normalizeTtlTimestamp,
  TTL_FORMAT_ERROR,
  ttlInstantForComparison,
} from './ttl'
import type { CellColumn, CellValue, CoerceResult } from './types'

/** Every column type id, in picker order. */
export const CELL_TYPES = [
  'string',
  'number',
  'currency',
  'boolean',
  'date',
  'ttl',
  'json',
  'select',
] as const

/** A column type id. */
export type CellType = (typeof CELL_TYPES)[number]

/** One column type's value rules. */
export interface CellRule {
  /**
   * The value to store for a written `value`: unchanged when it already fits, converted when the
   * conversion is unambiguous (`"1999"` to `1999`), and `ok: false` when no safe conversion exists.
   */
  coerce(value: CellValue, column: CellColumn): CoerceResult
  /** A stored cell's shape: an error message, or `null` when it is valid. */
  validateCell(value: CellValue, column: CellColumn): string | null
  /**
   * A last-resort reading of a value {@link coerce} refused, consulted only where the write
   * cannot fail (a blanked cell is the alternative). Absent where nothing is salvageable.
   */
  salvage?(value: CellValue, column: CellColumn): CoerceResult
  /** The value two cells compare by for a unique column; absent compares the value itself. */
  valueForEquality?(value: CellValue): CellValue
}

/** Each column type's {@link CellRule}. */
export const CELL_RULES: { readonly [T in CellType]: CellRule } = {
  string: {
    coerce(value) {
      if (typeof value === 'string') return { ok: true, value }
      if (typeof value === 'number' || typeof value === 'boolean') {
        return { ok: true, value: String(value) }
      }
      return { ok: false }
    },

    validateCell(value, column) {
      return typeof value === 'string' ? null : `${column.name} must be string, got ${typeof value}`
    },
  },
  number: {
    coerce(value) {
      if (typeof value === 'number') {
        return Number.isFinite(value) ? { ok: true, value } : { ok: false }
      }
      if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false }
      }
      return { ok: false }
    },

    validateCell(value, column) {
      return typeof value === 'number' && !Number.isNaN(value)
        ? null
        : `${column.name} must be number`
    },
  },
  boolean: {
    coerce(value) {
      if (typeof value === 'boolean') return { ok: true, value }
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        if (normalized === 'true') return { ok: true, value: true }
        if (normalized === 'false') return { ok: true, value: false }
      }
      return { ok: false }
    },

    validateCell(value, column) {
      return typeof value === 'boolean' ? null : `${column.name} must be boolean`
    },
  },
  date: {
    coerce(value) {
      if (typeof value === 'string') {
        const normalized = normalizeDateCellValue(value)
        return normalized === null ? { ok: false } : { ok: true, value: normalized }
      }
      // A bare number is refused wherever there is a caller to tell. It is the
      // one input whose meaning cannot be recovered from the value itself: `1600000000` is
      // September 2020 read as Unix seconds and 19 January 1970 read as
      // milliseconds, both readings are in range, and nothing on the wire says
      // which was meant — picking either silently stores a timestamp 50 years off
      // under a 200. An ISO-8601 string carries its own unit; that is what a date
      // cell takes. `salvage` keeps the milliseconds reading for the machine
      // paths, where the only other answer is a blank cell.
      //
      // A Date instance may still be out of the representable range (>±8.64e15ms),
      // so `toISOString()` is guarded — it throws RangeError on an Invalid Date —
      // and an over-range value degrades to `{ ok: false }` rather than crashing
      // the write.
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return { ok: true, value: value.toISOString() }
      }
      return { ok: false }
    },

    salvage(value) {
      // Milliseconds — the reading every caller got before — restored only where
      // refusing would blank the cell rather than answer anyone. A machine
      // emitting an epoch for a date column is overwhelmingly producing
      // `Date.now()` or another JS timestamp, both milliseconds; guessing wrong
      // there costs a wrong year, guessing not at all costs the value.
      if (typeof value !== 'number') return { ok: false }
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? { ok: false } : { ok: true, value: date.toISOString() }
    },

    validateCell(value, column) {
      const valid =
        value instanceof Date || (typeof value === 'string' && !Number.isNaN(Date.parse(value)))
      return valid ? null : `${column.name} must be valid date`
    },
  },
  ttl: {
    coerce(value) {
      const normalized = normalizeTtlTimestamp(value)
      return normalized === null ? { ok: false } : { ok: true, value: normalized }
    },

    valueForEquality(value) {
      return ttlInstantForComparison(value) ?? value
    },

    validateCell(value, column) {
      return isTtlTimestamp(value) ? null : `${column.name}: ${TTL_FORMAT_ERROR}`
    },
  },
  json: {
    coerce(value) {
      // Anything JSON-serializable is already valid — this is the widest type.
      return { ok: true, value }
    },

    validateCell(value, column) {
      try {
        JSON.stringify(value)
        return null
      } catch {
        return `${column.name} must be valid JSON`
      }
    },
  },
  select: {
    coerce(value, column) {
      if (column.multiple) {
        // `resolveSelectCellValue` DROPS parts that match no option, which is
        // right for a display read of a cell whose option was since deleted, but
        // is a silent discard on a write: `["green"]` would resolve to `[]` and
        // store an empty cell for a value the caller asked to keep. A write only
        // coerces when every part it named resolves — the same rule the single
        // branch has always had, and the same rule `isCompatibleWith` uses for
        // the bulk conversion.
        const options = column.options ?? []
        const parts = splitMultiSelectInput(value)
        if (parts.some((part) => resolveSelectOptionId(part, options) === null))
          return { ok: false }
      }
      const resolved = resolveSelectCellValue(value, column)
      // A single target that matches no option has nothing safe to store.
      return resolved === null ? { ok: false } : { ok: true, value: resolved }
    },

    salvage(value, column) {
      // Where the write cannot fail, a multi cell keeps the members that DO
      // resolve rather than being blanked: `Alpha, opt_b, ghost` from a CSV or a
      // block output stores `[opt_a, opt_b]`, which is what it stored before the
      // write path started refusing partial matches. Dropping one unmatched name
      // is a smaller loss than erasing the two that matched. A single cell holds
      // one option and has nothing partial to keep, so it stays blanked.
      if (!column.multiple) return { ok: false }
      const resolved = resolveSelectCellValue(value, column)
      return resolved === null ? { ok: false } : { ok: true, value: resolved }
    },

    validateCell(value, column) {
      const ids = optionIds(column)
      if (column.multiple) {
        if (!Array.isArray(value)) return `${column.name} must be a list of options`
        if (!value.every((v) => typeof v === 'string' && ids.has(v))) {
          return `${column.name} must only contain defined options`
        }
        if (column.required && value.length === 0) return `Missing required field: ${column.name}`
        return null
      }
      return typeof value === 'string' && ids.has(value)
        ? null
        : `${column.name} must be one of the defined options`
    },
  },
  currency: {
    coerce(value, column) {
      // Stored as a bare number, but accepts the formatted shapes an amount
      // arrives in — `$1,234.56`, `1 234,56 €`, `(12.00)` — so a paste, CSV
      // import, or tool write lands as a number rather than being nulled.
      const parsed = parseCurrencyInput(value, column.currencyCode)
      return parsed === null ? { ok: false } : { ok: true, value: parsed }
    },

    validateCell(value, column) {
      // A currency cell is a plain number; `currencyCode` is display metadata and
      // never part of the stored value.
      return typeof value === 'number' && !Number.isNaN(value)
        ? null
        : `${column.name} must be number`
    },
  },
}

/** The rules of `column`'s type: `string`'s for a type that is not (or no longer) a known one. */
export function cellRuleOf(column: Pick<CellColumn, 'type'>): CellRule {
  const type = CELL_TYPES.find((known) => known === column.type)
  return type === undefined ? CELL_RULES.string : CELL_RULES[type]
}
