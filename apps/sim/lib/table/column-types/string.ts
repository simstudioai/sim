import { TypeText } from '@sim/emcn/icons'
import { CELL_RULES } from '@sim/table-cells/rules'
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

  ...CELL_RULES.string,

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
