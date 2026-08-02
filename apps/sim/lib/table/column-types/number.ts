import { TypeNumber } from '@sim/emcn/icons'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'
import { ownedKeysOf } from '@/lib/table/column-types/types'
import { clampPrecision, DEFAULT_PRECISION, formatWithPrecision } from '@/lib/table/precision'

export const numberColumnType: ColumnTypeDefinition = {
  id: 'number',
  label: 'Number',
  icon: TypeNumber,
  jsonbCast: 'numeric',
  canonicalizesValues: true,
  orderable: true,
  storesOpaqueIds: false,
  supportsUnique: true,
  sampleValue: 123,
  ownedMetadata: ownedKeysOf('number'),
  workflowInputType: 'number',
  editor: 'text',
  expandable: false,
  inputMode: 'decimal',
  typeaheadPattern: /[\d.-]/,
  parseErrorMessage: 'Invalid number',

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

  validateDefinition(column) {
    if (column.precision === undefined) return []
    return clampPrecision(column.precision) === column.precision
      ? []
      : [
          `Column "${column.name}" has invalid precision ${column.precision}. Use a whole number of decimal places between 0 and ${DEFAULT_PRECISION.max}`,
        ]
  },

  describe(column) {
    return column.precision === undefined
      ? 'Number'
      : `Number (${clampPrecision(column.precision)} dp)`
  },

  formatForDisplay(value, column) {
    if (typeof value !== 'number') return String(value)
    return formatWithPrecision(value, column.precision)
  },

  formatForInput(value) {
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  },
}
