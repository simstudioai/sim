import { TypeJson } from '@sim/emcn/icons'
import { CELL_RULES } from '@sim/table-cells/rules'
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

  ...CELL_RULES.json,

  formatForDisplay(value) {
    return JSON.stringify(value)
  },

  formatForInput(value) {
    return typeof value === 'string' ? value : JSON.stringify(value)
  },
}
