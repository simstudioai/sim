import type {
  LogRocketListExportedSessionsParams,
  LogRocketListExportedSessionsResponse,
} from '@/tools/logrocket/types'
import { buildAppUrl, buildAuthHeaders, throwOnError } from '@/tools/logrocket/utils'
import type { ToolConfig } from '@/tools/types'

export const listExportedSessionsTool: ToolConfig<
  LogRocketListExportedSessionsParams,
  LogRocketListExportedSessionsResponse
> = {
  id: 'logrocket_list_exported_sessions',
  name: 'LogRocket List Exported Sessions',
  description:
    'List exported session files from the LogRocket Data Export API. Returns download URLs for JSON Lines exports, oldest first, plus a cursor for the next page.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LogRocket API key',
    },
    orgId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LogRocket organization ID',
    },
    appId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LogRocket project (app) ID',
    },
    apiHost: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'API host override for Private Cloud deployments',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor from a previous page, used to fetch newer sessions',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page. Defaults to 10, maximum 100.',
    },
    date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unix timestamp in milliseconds to start listing from',
    },
  },

  request: {
    url: (params) => {
      const url = buildAppUrl(params, 'data-export/')
      if (params.cursor) url.searchParams.set('cursor', params.cursor.trim())
      if (params.limit) url.searchParams.set('limit', params.limit.trim())
      if (params.date) url.searchParams.set('date', params.date.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => buildAuthHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = (await throwOnError(response, 'LogRocket Data Export API')) as {
      cursor?: string | number
      sessions?: Array<{ url?: string }>
    } | null

    const sessions = (data?.sessions ?? []).map((session) => ({
      url: session.url ?? null,
    }))

    return {
      success: true,
      output: {
        sessions,
        cursor: data?.cursor === undefined || data.cursor === null ? null : String(data.cursor),
      },
    }
  },

  outputs: {
    sessions: {
      type: 'array',
      description: 'Exported session files',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Download URL for the JSON Lines export file' },
        },
      },
    },
    cursor: {
      type: 'string',
      description: 'Opaque cursor for the next page of results',
      optional: true,
    },
  },
}
