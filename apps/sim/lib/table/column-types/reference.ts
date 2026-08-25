import { Table as TableIcon } from '@sim/emcn/icons'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'

export const referenceColumnType: ColumnTypeDefinition = {
  id: 'reference',
  label: 'Reference',
  icon: TableIcon,
  jsonbCast: null,
  storesOpaqueIds: false,
  supportsUnique: true,
  requiresConfigurationOnCreate: true,
  hasConfiguration: true,
  sampleValue: 'row_123',
  ownedMetadata: ['referenceTableId'],
  workflowInputType: 'string',
  editor: 'text',
  expandable: false,

  coerce(value) {
    if (typeof value === 'string') return { ok: true, value }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return { ok: true, value: String(value) }
    }
    return { ok: false }
  },

  validateCell(value, column) {
    return typeof value === 'string' ? null : `${column.name} must be a row ID string`
  },

  validateDefinition(column) {
    if (typeof column.referenceTableId !== 'string' || column.referenceTableId.length === 0) {
      return [`Column "${column.name}" must define a reference table ID`]
    }
    return []
  },

  formatForDisplay(value) {
    if (typeof value === 'string') return value
    if (value === null || value === undefined) return ''
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  },

  formatForInput(value) {
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  },
}
