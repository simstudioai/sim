import { TypeNumber } from '@sim/emcn/icons'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'

export const numberColumnType: ColumnTypeDefinition = {
  id: 'number',
  label: 'Number',
  icon: TypeNumber,
  badgeVariant: 'blue',
  jsonbCast: 'numeric',
  filterOperators: null,
  storesOpaqueIds: false,
  inferFromCsv: true,
  ownedMetadata: [],
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

  validateDefinition() {
    return []
  },

  isCompatibleWith(value) {
    if (typeof value === 'number') return Number.isFinite(value)
    if (typeof value === 'string') {
      const num = Number(value)
      return Number.isFinite(num) && value.trim() !== ''
    }
    return false
  },

  formatForDisplay(value) {
    return String(value)
  },

  formatForInput(value) {
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  },
}
