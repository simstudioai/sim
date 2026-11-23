import { TypeNumber } from '@sim/emcn/icons'
import { CELL_RULES } from '@sim/table-cells/rules'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'

export const numberColumnType: ColumnTypeDefinition = {
  id: 'number',
  label: 'Number',
  icon: TypeNumber,
  jsonbCast: 'numeric',
  storesOpaqueIds: false,
  supportsUnique: true,
  sampleValue: 123,
  ownedMetadata: [],
  workflowInputType: 'number',
  editor: 'text',
  expandable: false,
  inputMode: 'decimal',
  typeaheadPattern: /[\d.-]/,
  parseErrorMessage: 'Invalid number',

  ...CELL_RULES.number,

  formatForDisplay(value) {
    return String(value)
  },

  formatForInput(value) {
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  },
}
