import { Calendar as CalendarIcon } from '@sim/emcn/icons'
import { formatDateCellDisplay, storedDateToEditable } from '@sim/table-cells/dates'
import { CELL_RULES } from '@sim/table-cells/rules'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'

export const dateColumnType: ColumnTypeDefinition = {
  id: 'date',
  label: 'Date',
  icon: CalendarIcon,
  jsonbCast: 'timestamptz',
  storesOpaqueIds: false,
  supportsUnique: true,
  sampleValue: '2024-01-31',
  ownedMetadata: [],
  workflowInputType: 'string',
  editor: 'date',
  expandable: false,
  typeaheadPattern: /[\d\-/]/,
  parseErrorMessage: 'Invalid date',

  ...CELL_RULES.date,

  formatForDisplay(value) {
    return formatDateCellDisplay(String(value), { seconds: true })
  },

  formatForInput(value) {
    return storedDateToEditable(String(value))
  },
}
