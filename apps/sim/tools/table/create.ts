import type { ToolConfig } from '@/tools/types'
import type { TableCreateParams, TableCreateResponse } from './types'

export const tableCreateTool: ToolConfig<TableCreateParams, TableCreateResponse> = {
  id: 'table_create',
  name: 'Create Table',
  description: 'Create a new user-defined table with schema',
  version: '1.0.0',

  params: {
    name: {
      type: 'string',
      required: true,
      description: 'Table name (alphanumeric, underscores, 1-50 chars)',
      visibility: 'user-or-llm',
    },
    description: {
      type: 'string',
      required: false,
      description: 'Optional table description',
      visibility: 'user-or-llm',
    },
    schema: {
      type: 'object',
      required: true,
      description: 'Table schema with column definitions',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: '/api/table',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('Workspace ID is required in execution context')
      }

      return {
        name: params.name,
        description: params.description,
        schema: params.schema,
        workspaceId,
      }
    },
  },

  transformResponse: async (response): Promise<TableCreateResponse> => {
    const result = await response.json()
    const data = result.data || result

    return {
      success: true,
      output: {
        table: data.table,
        message: data.message || 'Table created successfully',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether table was created' },
    table: { type: 'json', description: 'Created table metadata' },
    message: { type: 'string', description: 'Status message' },
  },
}
