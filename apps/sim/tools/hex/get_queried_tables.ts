import type { HexGetQueriedTablesParams, HexGetQueriedTablesResponse } from '@/tools/hex/types'
import { HEX_HOST_PARAM, hexApiBase } from '@/tools/hex/utils'
import { HEX_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const getQueriedTablesTool: ToolConfig<
  HexGetQueriedTablesParams,
  HexGetQueriedTablesResponse
> = {
  id: 'hex_get_queried_tables',
  name: 'Hex Get Queried Tables',
  description:
    'Return the warehouse tables queried by a Hex project, including data connection and table names.',
  version: '1.0.0',
  oauth: HEX_CREDENTIAL_OAUTH,

  params: {
    host: HEX_HOST_PARAM,
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
      description: 'Maximum number of tables to return (1-100, default: 25)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor to fetch the page of results after this value',
    },
    before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor to fetch the page of results before this value',
    },
  },

  request: {
    url: (params) => {
      const searchParams = new URLSearchParams()
      if (params.limit) searchParams.set('limit', String(params.limit))
      if (params.after) searchParams.set('after', params.after)
      if (params.before) searchParams.set('before', params.before)
      const qs = searchParams.toString()
      return `${hexApiBase(params.host)}/projects/${safeUrlPathSegment(params.projectId, 'projectId')}/queriedTables${qs ? `?${qs}` : ''}`
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
        after: data.pagination?.after ?? null,
        before: data.pagination?.before ?? null,
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
    after: { type: 'string', description: 'Cursor for the next page of results', optional: true },
    before: {
      type: 'string',
      description: 'Cursor for the previous page of results',
      optional: true,
    },
  },
}
