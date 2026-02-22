import type {
  HexListDataConnectionsParams,
  HexListDataConnectionsResponse,
} from '@/tools/hex/types'
import type { ToolConfig } from '@/tools/types'

export const listDataConnectionsTool: ToolConfig<
  HexListDataConnectionsParams,
  HexListDataConnectionsResponse
> = {
  id: 'hex_list_data_connections',
  name: 'Hex List Data Connections',
  description:
    'List all data connections in the Hex workspace (e.g., Snowflake, PostgreSQL, BigQuery).',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Hex API token (Personal or Workspace)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of connections to return (1-100, default: 25)',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Sort by field: CREATED_AT or NAME',
    },
    sortDirection: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Sort direction: ASC or DESC',
    },
  },

  request: {
    url: (params) => {
      const searchParams = new URLSearchParams()
      if (params.limit) searchParams.set('limit', String(params.limit))
      if (params.sortBy) searchParams.set('sortBy', params.sortBy)
      if (params.sortDirection) searchParams.set('sortDirection', params.sortDirection)
      const qs = searchParams.toString()
      return `https://app.hex.tech/api/v1/data-connections${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const connections = Array.isArray(data) ? data : (data.values ?? [])

    return {
      success: true,
      output: {
        connections: connections.map((c: Record<string, unknown>) => ({
          id: (c.id as string) ?? null,
          name: (c.name as string) ?? null,
          type: (c.type as string) ?? null,
          description: (c.description as string) ?? null,
          connectViaSsh: (c.connectViaSsh as boolean) ?? null,
          includeMagic: (c.includeMagic as boolean) ?? null,
          allowWritebackCells: (c.allowWritebackCells as boolean) ?? null,
        })),
        total: connections.length,
      },
    }
  },

  outputs: {
    connections: {
      type: 'array',
      description: 'List of data connections',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Connection UUID' },
          name: { type: 'string', description: 'Connection name' },
          type: {
            type: 'string',
            description:
              'Connection type (e.g., athena, bigquery, databricks, postgres, redshift, snowflake)',
          },
          description: { type: 'string', description: 'Connection description', optional: true },
          connectViaSsh: {
            type: 'boolean',
            description: 'Whether SSH tunneling is enabled',
            optional: true,
          },
          includeMagic: {
            type: 'boolean',
            description: 'Whether Magic AI features are enabled',
            optional: true,
          },
          allowWritebackCells: {
            type: 'boolean',
            description: 'Whether writeback cells are allowed',
            optional: true,
          },
        },
      },
    },
    total: { type: 'number', description: 'Total number of connections returned' },
  },
}
