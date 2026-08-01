import { TypePercent } from '@sim/emcn/icons'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'
import { ownedKeysOf } from '@/lib/table/column-types/types'
import { clampPrecision, DEFAULT_PRECISION, formatWithPrecision } from '@/lib/table/precision'

/**
 * Parses a percent input into its stored number.
 *
 * Stores the number as shown, NOT a 0–1 fraction: a cell reading `25%` holds
 * `25`. That keeps the stored value the same one a `number` column would hold,
 * so converting between `number` and `percent` rewrites nothing and a filter
 * written against either column means the same thing.
 */
function parsePercent(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/%$/, '').trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

export const percentColumnType: ColumnTypeDefinition = {
  id: 'percent',
  label: 'Percent',
  icon: TypePercent,
  jsonbCast: 'numeric',
  orderable: true,
  storesOpaqueIds: false,
  supportsUnique: true,
  sampleValue: 25,
  ownedMetadata: ownedKeysOf('percent'),
  workflowInputType: 'number',
  editor: 'text',
  expandable: false,
  inputMode: 'decimal',
  // Accepts the trailing `%` a user types first, which an `<input type=number>`
  // would reject outright.
  acceptsFormattedInput: true,
  typeaheadPattern: /[\d.\-%]/,
  parseErrorMessage: 'Invalid percentage',

  coerce(value) {
    const parsed = parsePercent(value)
    return parsed === null ? { ok: false } : { ok: true, value: parsed }
  },

  validateCell(value, column) {
    return typeof value === 'number' && !Number.isNaN(value)
      ? null
      : `${column.name} must be number`
  },

  validateDefinition(column) {
    if (column.precision === undefined) return []
    return clampPrecision(column.precision) === column.precision
      ? []
      : [
          `Column "${column.name}" has invalid precision ${column.precision}. Use a whole number of decimal places between 0 and ${DEFAULT_PRECISION.max}`,
        ]
  },

  formatForDisplay(value, column) {
    if (typeof value !== 'number') return ''
    return `${formatWithPrecision(value, column.precision)}%`
  },

  // The `%` is chrome, not data — an editor pre-filled with it would make the
  // user delete it before typing.
  formatForInput(value) {
    return typeof value === 'number' ? String(value) : ''
  },

  describe(column) {
    return column.precision === undefined
      ? 'Percent'
      : `Percent (${clampPrecision(column.precision)} dp)`
  },
}
