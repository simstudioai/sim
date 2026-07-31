import { TypeText } from '@sim/emcn/icons'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'

export const stringColumnType: ColumnTypeDefinition = {
  id: 'string',
  label: 'Text',
  icon: TypeText,
  jsonbCast: null,
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
