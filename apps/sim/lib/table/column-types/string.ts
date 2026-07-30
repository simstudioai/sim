import { TypeText } from '@sim/emcn/icons'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'

export const stringColumnType: ColumnTypeDefinition = {
  id: 'string',
  label: 'Text',
  icon: TypeText,
  jsonbCast: null,
  filterOperators: null,
  storesOpaqueIds: false,
  supportsUnique: true,
  sampleValue: 'example',
  ownedMetadata: [],
  workflowInputType: 'string',
  editor: 'text',
  expandable: true,

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

  validateDefinition() {
    return []
  },

  isCompatibleWith(value) {
    // Arrays and objects can't become text — the write-path coercion rejects
    // them and would null the cell. Multi-select values are flattened before
    // this check, so anything still structured here is genuinely lossy.
    return typeof value !== 'object'
  },

  formatForDisplay(value) {
    if (typeof value === 'string') return value
    if (value === null || value === undefined) return ''
    return JSON.stringify(value)
  },

  formatForInput(value) {
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  },
}
