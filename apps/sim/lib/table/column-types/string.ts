import { TypeText } from '@sim/emcn/icons'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'
import { ownedKeysOf } from '@/lib/table/column-types/types'

export const stringColumnType: ColumnTypeDefinition = {
  id: 'string',
  label: 'Text',
  icon: TypeText,
  jsonbCast: null,
  canonicalizesValues: false,
  orderable: true,
  storesOpaqueIds: false,
  supportsUnique: true,
  sampleValue: 'example',
  ownedMetadata: ownedKeysOf('string'),
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

  // Linkable: a string cell holding nothing but a URL is promoted by the grid
  // to a favicon link or an in-workspace resource chip.
  display(value, column) {
    if (value === null || value === undefined) return { kind: 'empty' }
    return { kind: 'linkable', text: stringColumnType.formatForDisplay(value, column) }
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
