import { TableIcon } from '@/components/icons'
import { requestJson } from '@/lib/api/client/request'
import { listTablesContract } from '@/lib/api/contracts/tables'
import type { TableDefinition } from '@/lib/table'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { tableKeys } from '@/hooks/queries/tables'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import type { TriggerConfig } from '@/triggers/types'

async function fetchTableColumns(blockId: string): Promise<Array<{ label: string; id: string }>> {
  const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
  const workspaceId = useWorkflowRegistry.getState().hydration.workspaceId
  if (!activeWorkflowId || !workspaceId) return []

  const blockValues = useSubBlockStore.getState().workflowValues[activeWorkflowId]?.[blockId]
  const tableId = (blockValues?.tableSelector as string) || (blockValues?.manualTableId as string)
  if (!tableId) return []

  const tables = await getQueryClient().fetchQuery({
    queryKey: tableKeys.list(workspaceId),
    queryFn: async ({ signal }): Promise<TableDefinition[]> => {
      const response = await requestJson(listTablesContract, {
        query: { workspaceId, scope: 'active' },
        signal,
      })
      return (response.data.tables ?? []) as TableDefinition[]
    },
    staleTime: 60 * 1000,
  })

  const table = tables.find((t: TableDefinition) => t.id === tableId)
  if (!table?.schema?.columns) return []

  return table.schema.columns.map((col) => ({ id: col.name, label: col.name }))
}

export const tableNewRowTrigger: TriggerConfig = {
  id: 'table_new_row',
  name: 'Table Trigger',
  provider: 'table',
  description: 'Triggers when rows are inserted or updated in a table',
  version: '1.0.0',
  icon: TableIcon,

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
      multiSelect: true,
      options: [],
      placeholder: 'All columns',
      description: 'Only fire when these columns change. Leave empty to fire on any update.',
      required: false,
      mode: 'trigger',
      condition: { field: 'eventType', value: 'update' },
      dependsOn: { any: ['tableSelector', 'manualTableId'] },
      fetchOptions: fetchTableColumns,
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
        'Choose whether to trigger on row inserts or updates',
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
      description: 'Previous row data before the update (null for inserts)',
    },
    changedColumns: {
      type: 'json',
      description: 'List of column names that changed (empty for inserts)',
    },
    rowId: {
      type: 'string',
      description: 'The unique row ID',
    },
    headers: {
      type: 'json',
      description: 'Column names from the table schema',
    },
    rowNumber: {
      type: 'number',
      description: 'The position of the row in the table',
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
