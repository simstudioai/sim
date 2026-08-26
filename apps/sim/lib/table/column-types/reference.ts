import { Table as TableIcon } from '@sim/emcn/icons'
import { stringColumnType } from '@/lib/table/column-types/string'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'
import { MAX_REFERENCE_TABLE_ID_LENGTH } from '@/lib/table/constants'

export const referenceColumnType: ColumnTypeDefinition = {
  id: 'reference',
  label: 'Reference',
  icon: TableIcon,
  jsonbCast: null,
  storesOpaqueIds: false,
  supportsUnique: true,
  sampleValue: 'row_123',
  ownedMetadata: ['referenceTableId'],
  workflowInputType: 'string',
  editor: 'text',
  expandable: false,

  coerce: stringColumnType.coerce,

  validateCell(value, column) {
    return typeof value === 'string' ? null : `${column.name} must be a row ID string`
  },

  validateDefinition(column) {
    if (typeof column.referenceTableId !== 'string' || column.referenceTableId.length === 0) {
      return [`Column "${column.name}" must define a reference table ID`]
    }
    if (column.referenceTableId.length > MAX_REFERENCE_TABLE_ID_LENGTH) {
      return [
        `Column "${column.name}" reference table ID must be ${MAX_REFERENCE_TABLE_ID_LENGTH} characters or less`,
      ]
    }
    return []
  },

  formatForDisplay(value) {
    if (typeof value === 'string') return value
    if (value === null || value === undefined) return ''
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  },

  formatForInput: stringColumnType.formatForInput,
}
