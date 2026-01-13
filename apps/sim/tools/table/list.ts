import type { ToolConfig } from '@/tools/types'
import type { TableListParams, TableListResponse } from './types'

export const tableListTool: ToolConfig<TableListParams, TableListResponse> = {
  id: 'table_list',
  name: 'List Tables',
  description: 'List all tables in the workspace',
  version: '1.0.0',

  params: {},

  request: {
    url: (params: any) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('workspaceId is required in execution context')
      }
      return `/api/table?workspaceId=${encodeURIComponent(workspaceId)}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<TableListResponse> => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list tables')
    }

    return {
      success: true,
      output: {
        tables: data.tables,
        totalCount: data.totalCount,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether operation succeeded' },
    tables: { type: 'array', description: 'List of tables' },
    totalCount: { type: 'number', description: 'Total number of tables' },
  },
}
