import type { HexGetQueriedTablesParams, HexGetQueriedTablesResponse } from '@/tools/hex/types'
import type { ToolConfig } from '@/tools/types'

export const getQueriedTablesTool: ToolConfig<
  HexGetQueriedTablesParams,
  HexGetQueriedTablesResponse
> = {
  id: 'hex_get_queried_tables',
  name: 'Hex Get Queried Tables',
  description:
    'Return the warehouse tables queried by a Hex project, including data connection and table names.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Hex API token (Personal or Workspace)',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the Hex project',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of tables to return (1-100)',
    },
  },

  request: {
    url: (params) => {
      const searchParams = new URLSearchParams()
      if (params.limit) searchParams.set('limit', String(params.limit))
      const qs = searchParams.toString()
      return `https://app.hex.tech/api/v1/projects/${params.projectId}/queriedTables${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const tables = Array.isArray(data) ? data : (data.values ?? [])

    return {
      success: true,
      output: {
        tables: tables.map((t: Record<string, unknown>) => ({
          dataConnectionId: (t.dataConnectionId as string) ?? null,
          dataConnectionName: (t.dataConnectionName as string) ?? null,
          tableName: (t.tableName as string) ?? null,
        })),
        total: tables.length,
      },
    }
  },

  outputs: {
    tables: {
      type: 'array',
      description: 'List of warehouse tables queried by the project',
      items: {
        type: 'object',
        properties: {
          dataConnectionId: { type: 'string', description: 'Data connection UUID' },
          dataConnectionName: { type: 'string', description: 'Data connection name' },
          tableName: { type: 'string', description: 'Table name' },
        },
      },
    },
    total: { type: 'number', description: 'Total number of tables returned' },
  },
}
