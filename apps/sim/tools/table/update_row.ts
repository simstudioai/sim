import { selectTableRowSecretProvenance } from '@/lib/table/secret-provenance-selection'
import { enrichTableToolSchema } from '@/tools/schema-enrichers'
import { TABLE_ID_PARAM } from '@/tools/table/params'
import { placeholderRow, tableSuccess } from '@/tools/table/response'
import {
  IGNORED_COLUMNS_OUTPUT,
  type TableRowUpdateParams,
  type TableRowWriteResponse,
} from '@/tools/table/types'
import type { InternalToolConfig } from '@/tools/types'

export const tableUpdateRowTool: InternalToolConfig<TableRowUpdateParams, TableRowWriteResponse> = {
  id: 'table_update_row',
  name: 'Update Row',
  description:
    'Update an existing row in a table. Supports partial updates - only include the fields you want to change. IMPORTANT: You must use the "data" parameter (not "values", "row", "fields", or other variations) to specify the fields to update.',
  version: '1.0.0',
  effect: 'write',

  toolEnrichment: {
    dependsOn: 'tableId',
    enrichTool: (tableId, schema, desc, context) =>
      enrichTableToolSchema(tableId, 'table_update_row', schema, desc, context),
  },

  params: {
    tableId: TABLE_ID_PARAM,
    rowId: {
      type: 'string',
      required: true,
      description: 'Row ID to update',
      visibility: 'user-or-llm',
    },
    data: {
      type: 'object',
      required: true,
      description: 'Updated row data',
      visibility: 'user-or-llm',
    },
  },

  operation: {
    secretProvenance: {
      request: (params) => selectTableRowSecretProvenance([params.data]),
      response: { incomplete: 'propagate' },
    },
    input: (params: TableRowUpdateParams) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('Workspace ID is required in execution context')
      }

      return {
        tableId: params.tableId,
        rowId: params.rowId,
        data: params.data,
        workspaceId,
      }
    },
  },

  /**
   * A dry run's placeholder is the row named, holding only the fields the call patches: its other
   * columns are stored state the request cannot know.
   */
  dryRunOutput: (params) => ({
    row: placeholderRow(params.data, 0, params.rowId),
    ignoredColumns: [],
  }),

  transformResponse: async (response): Promise<TableRowWriteResponse> => {
    const result = await response.json()
    const data = result.data || result

    return tableSuccess({
      row: data.row,
      message: data.message || 'Row updated successfully',
      ignoredColumns: data.ignoredColumns ?? [],
    })
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether row was updated' },
    row: { type: 'json', description: 'Updated row data' },
    ignoredColumns: IGNORED_COLUMNS_OUTPUT,
    message: { type: 'string', description: 'Status message' },
  },
}
