import { TypeJson } from '@sim/emcn/icons'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'
import { ownedKeysOf } from '@/lib/table/column-types/types'

export const jsonColumnType: ColumnTypeDefinition = {
  id: 'json',
  label: 'JSON',
  icon: TypeJson,
  jsonbCast: null,
  canonicalizesValues: false,
  orderable: false,
  storesOpaqueIds: false,
  supportsUnique: true,
  sampleValue: 'value',
  ownedMetadata: ownedKeysOf('json'),
  workflowInputType: 'object',
  editor: 'json',
  expandable: true,

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

  display(value) {
    if (value === null || value === undefined) return { kind: 'empty' }
    return { kind: 'json', text: JSON.stringify(value) }
  },

  formatForDisplay(value) {
    return JSON.stringify(value)
  },

  formatForInput(value) {
    return typeof value === 'string' ? value : JSON.stringify(value)
  },
}
