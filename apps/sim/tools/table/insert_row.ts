import { selectTableRowSecretProvenance } from '@/lib/table/secret-provenance-selection'
import { enrichTableToolSchema } from '@/tools/schema-enrichers'
import { TABLE_ID_PARAM } from '@/tools/table/params'
import { tableSuccess } from '@/tools/table/response'
import {
  IGNORED_COLUMNS_OUTPUT,
  type TableRowInsertParams,
  type TableRowWriteResponse,
} from '@/tools/table/types'
import type { InternalToolConfig } from '@/tools/types'

export const tableInsertRowTool: InternalToolConfig<TableRowInsertParams, TableRowWriteResponse> = {
  id: 'table_insert_row',
  name: 'Insert Row',
  description:
    'Insert a new row into a table. IMPORTANT: You must use the "data" parameter (not "values", "row", "fields", or other variations) to specify the row contents.',
  version: '1.0.0',

  toolEnrichment: {
    dependsOn: 'tableId',
    enrichTool: (tableId, schema, desc, context) =>
      enrichTableToolSchema(tableId, 'table_insert_row', schema, desc, context),
  },

  params: {
    tableId: TABLE_ID_PARAM,
    data: {
      type: 'object',
      required: true,
      description: 'Row data as JSON object',
      visibility: 'user-or-llm',
    },
  },

  operation: {
    secretProvenance: {
      request: (params) => selectTableRowSecretProvenance([params.data]),
      response: { incomplete: 'propagate' },
    },
    input: (params: TableRowInsertParams) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('Workspace ID is required in execution context')
      }

      return {
        tableId: params.tableId,
        data: params.data,
        workspaceId,
      }
    },
  },

  transformResponse: async (response): Promise<TableRowWriteResponse> => {
    const result = await response.json()
    const data = result.data || result

    return tableSuccess({
      row: data.row,
      message: data.message || 'Row inserted successfully',
      ignoredColumns: data.ignoredColumns ?? [],
    })
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether row was inserted' },
    row: { type: 'json', description: 'Inserted row data' },
    ignoredColumns: IGNORED_COLUMNS_OUTPUT,
    message: { type: 'string', description: 'Status message' },
  },
}
