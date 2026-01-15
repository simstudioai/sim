import type { ToolConfig } from '@/tools/types'
import type { TableQueryResponse, TableRowQueryParams } from './types'

export const tableQueryRowsTool: ToolConfig<TableRowQueryParams, TableQueryResponse> = {
  id: 'table_query_rows',
  name: 'Query Rows',
  description: 'Query rows from a table with filtering, sorting, and pagination',
  version: '1.0.0',

  params: {
    tableId: {
      type: 'string',
      required: true,
      description: 'Table ID',
      visibility: 'user-only',
    },
    filter: {
      type: 'object',
      required: false,
      description:
        'Filter conditions (MongoDB-style operators: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $contains)',
      visibility: 'user-or-llm',
    },
    sort: {
      type: 'object',
      required: false,
      description: 'Sort order as {field: "asc"|"desc"}',
      visibility: 'user-or-llm',
    },
    limit: {
      type: 'number',
      required: false,
      description: 'Maximum rows to return (default: 100, max: 1000)',
      visibility: 'user-or-llm',
    },
    offset: {
      type: 'number',
      required: false,
      description: 'Number of rows to skip (default: 0)',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params: TableRowQueryParams) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('Workspace ID is required in execution context')
      }

      const searchParams = new URLSearchParams({
        workspaceId,
      })

      if (params.filter) {
        searchParams.append('filter', JSON.stringify(params.filter))
      }
      if (params.sort) {
        searchParams.append('sort', JSON.stringify(params.sort))
      }
      if (params.limit !== undefined) {
        searchParams.append('limit', String(params.limit))
      }
      if (params.offset !== undefined) {
        searchParams.append('offset', String(params.offset))
      }

      return `/api/table/${params.tableId}/rows?${searchParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<TableQueryResponse> => {
    const result = await response.json()
    const data = result.data || result

    return {
      success: true,
      output: {
        rows: data.rows,
        rowCount: data.rowCount,
        totalCount: data.totalCount,
        limit: data.limit,
        offset: data.offset,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether query succeeded' },
    rows: { type: 'array', description: 'Query result rows' },
    rowCount: { type: 'number', description: 'Number of rows returned' },
    totalCount: { type: 'number', description: 'Total rows matching filter' },
    limit: { type: 'number', description: 'Limit used in query' },
    offset: { type: 'number', description: 'Offset used in query' },
  },
}
