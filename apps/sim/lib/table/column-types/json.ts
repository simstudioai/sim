import { TypeJson } from '@sim/emcn/icons'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'

export const jsonColumnType: ColumnTypeDefinition = {
  id: 'json',
  label: 'JSON',
  icon: TypeJson,
  jsonbCast: null,
  storesOpaqueIds: false,
  supportsUnique: true,
  sampleValue: 'value',
  ownedMetadata: [],
  workflowInputType: 'object',
  editor: 'text',
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

  formatForDisplay(value) {
    return JSON.stringify(value)
  },

  formatForInput(value) {
    return typeof value === 'string' ? value : JSON.stringify(value)
  },
}
