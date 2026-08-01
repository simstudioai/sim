import { TypeBoolean } from '@sim/emcn/icons'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'
import { ownedKeysOf } from '@/lib/table/column-types/types'

export const booleanColumnType: ColumnTypeDefinition = {
  id: 'boolean',
  label: 'Boolean',
  icon: TypeBoolean,
  jsonbCast: null,
  orderable: false,
  storesOpaqueIds: false,
  supportsUnique: true,
  sampleValue: true,
  ownedMetadata: ownedKeysOf('boolean'),
  workflowInputType: 'boolean',
  // Toggled in place on click, Enter, and fill — never opens an editor, so it
  // has no `typeaheadPattern` and the expanded popover skips it entirely.
  editor: 'toggle',
  expandable: false,

  coerce(value) {
    if (typeof value === 'boolean') return { ok: true, value }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (normalized === 'true') return { ok: true, value: true }
      if (normalized === 'false') return { ok: true, value: false }
    }
    return { ok: false }
  },

  validateCell(value, column) {
    return typeof value === 'boolean' ? null : `${column.name} must be boolean`
  },

  formatForDisplay(value) {
    return String(value)
  },

  // Draws even when the cell is empty: an absent boolean is an unchecked box,
  // not a blank, so every boolean cell reads as a clickable toggle.
  display(value) {
    return { kind: 'boolean', checked: Boolean(value) }
  },

  formatForInput(value) {
    return String(value)
  },
}
