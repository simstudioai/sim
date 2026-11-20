import { TypeBoolean } from '@sim/emcn/icons'
import { CELL_RULES } from '@sim/table-cells/rules'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'

export const booleanColumnType: ColumnTypeDefinition = {
  id: 'boolean',
  label: 'Boolean',
  icon: TypeBoolean,
  jsonbCast: null,
  storesOpaqueIds: false,
  supportsUnique: true,
  sampleValue: true,
  ownedMetadata: [],
  workflowInputType: 'boolean',
  // Toggled in place on click, Enter, and fill — never opens an editor, so it
  // has no `typeaheadPattern` and the expanded popover skips it entirely.
  editor: 'toggle',
  expandable: false,

  ...CELL_RULES.boolean,

  formatForDisplay(value) {
    return String(value)
  },

  formatForInput(value) {
    return String(value)
  },
}
