import {
  CONNECTION_PROPERTIES,
  type FivetranListConnectionsParams,
  type FivetranListConnectionsResponse,
  NEXT_CURSOR_OUTPUT,
} from '@/tools/fivetran/types'
import {
  envelopePage,
  FIVETRAN_AUTH_PARAMS,
  FIVETRAN_ERROR_EXTRACTOR,
  FIVETRAN_OAUTH,
  FIVETRAN_PAGINATION_PARAMS,
  fivetranHeaders,
  fivetranPaginationQuery,
  fivetranUrl,
  mapConnection,
  trimmed,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranListConnectionsTool: ToolConfig<
  FivetranListConnectionsParams,
  FivetranListConnectionsResponse
> = {
  id: 'fivetran_list_connections',
  name: 'Fivetran List Connections',
  description:
    'List Fivetran connections with their sync state, schedule, and last success or failure, optionally filtered by group or schema name.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    groupId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return connections in this group',
    },
    schema: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return the connection with this exact schema name',
    },
    ...FIVETRAN_PAGINATION_PARAMS,
  },

  request: {
    url: (params) =>
      fivetranUrl('/connections', {
        group_id: trimmed(params.groupId),
        schema: trimmed(params.schema),
        ...fivetranPaginationQuery(params),
      }),
    method: 'GET',
    headers: (params) => fivetranHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const { items, nextCursor } = envelopePage(await response.json())
    return { success: true, output: { connections: items.map(mapConnection), nextCursor } }
  },

  outputs: {
    connections: {
      type: 'array',
      description: 'Connections',
      items: { type: 'object', properties: CONNECTION_PROPERTIES },
    },
    ...NEXT_CURSOR_OUTPUT,
  },
}
