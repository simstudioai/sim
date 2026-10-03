import { Table } from '@sim/emcn/icons'
import type { TriggerConfig } from '@/triggers/types'

export const tableNewRowTrigger: TriggerConfig = {
  id: 'table_new_row',
  name: 'Table Trigger',
  provider: 'table',
  description: 'Triggers when rows are inserted, updated, or deleted in a table',
  version: '1.0.0',
  icon: Table,

  subBlocks: [
    {
      id: 'tableSelector',
      title: 'Table',
      type: 'table-selector',
      description: 'The table to monitor.',
      required: true,
      mode: 'trigger',
      canonicalParamId: 'tableId',
      placeholder: 'Select a table',
    },
    {
      id: 'manualTableId',
      title: 'Table ID',
      type: 'short-input',
      placeholder: 'Enter table ID',
      description: 'The table to monitor.',
      required: true,
      mode: 'trigger-advanced',
      canonicalParamId: 'tableId',
    },
    {
      id: 'eventType',
      title: 'Event',
      type: 'dropdown',
      options: [
        { id: 'insert', label: 'Row Inserted' },
        { id: 'update', label: 'Row Updated' },
        { id: 'delete', label: 'Row Deleted' },
      ],
      defaultValue: 'insert',
      description: 'The type of event to trigger on.',
      required: true,
      mode: 'trigger',
    },
    {
      id: 'watchColumns',
      title: 'Watch Columns',
      type: 'dropdown',
      selectorKey: 'table.columns',
      multiSelect: true,
      placeholder: 'All columns',
      description: 'Only fire when these columns change. Leave empty to fire on any update.',
      required: false,
      mode: 'trigger',
      condition: { field: 'eventType', value: 'update' },
      dependsOn: { any: ['tableSelector', 'manualTableId'] },
    },
    {
      id: 'includeHeaders',
      title: 'Map Row Values to Headers',
      type: 'switch',
      defaultValue: true,
      description:
        'When enabled, each row is returned as a key-value object mapped to column names.',
      required: false,
      mode: 'trigger',
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Select the table to monitor',
        'Choose whether to trigger on row inserts, updates, or deletes',
        'For updates, optionally select specific columns to watch',
        'The workflow will trigger automatically when the event occurs',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
    },
  ],

  outputs: {
    row: {
      type: 'json',
      description: 'Row data mapped to column names (when header mapping is enabled)',
    },
    rawRow: {
      type: 'json',
      description: 'Raw row data object',
    },
    previousRow: {
      type: 'json',
      description: 'Previous row data before an update or deletion (null for inserts)',
    },
    changedColumns: {
      type: 'json',
      description: 'List of column names that changed (empty for inserts and deletes)',
    },
    rowId: {
      type: 'string',
      description: 'The unique row ID',
    },
    headers: {
      type: 'json',
      description: 'Column names from the table schema',
    },
    tableId: {
      type: 'string',
      description: 'The table ID',
    },
    tableName: {
      type: 'string',
      description: 'The table name',
    },
    timestamp: {
      type: 'string',
      description: 'Event timestamp in ISO format',
    },
  },
}
