import type {
  DaytonaListSandboxesParams,
  DaytonaListSandboxesResponse,
} from '@/tools/daytona/types'
import {
  DAYTONA_API_BASE_URL,
  DAYTONA_SANDBOX_OUTPUT_PROPERTIES,
  extractDaytonaError,
  mapDaytonaSandbox,
  toOptionalNumber,
} from '@/tools/daytona/utils'
import { transformTable } from '@/tools/shared/table'
import type { ToolConfig } from '@/tools/types'

export const daytonaListSandboxesTool: ToolConfig<
  DaytonaListSandboxesParams,
  DaytonaListSandboxesResponse
> = {
  id: 'daytona_list_sandboxes',
  name: 'Daytona List Sandboxes',
  description: 'List Daytona sandboxes in the organization',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Daytona API key',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of sandboxes to return (1-200)',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter sandboxes by name prefix (case-insensitive)',
    },
    labels: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter sandboxes by labels as key-value pairs',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      const limit = toOptionalNumber(params.limit)
      if (limit !== undefined) {
        query.set('limit', String(Math.min(Math.max(Math.trunc(limit), 1), 200)))
      }
      if (params.name) query.set('name', params.name)
      const labels = transformTable(params.labels ?? null)
      if (Object.keys(labels).length > 0) query.set('labels', JSON.stringify(labels))
      if (params.cursor) query.set('cursor', params.cursor)
      const queryString = query.toString()
      return `${DAYTONA_API_BASE_URL}/sandbox${queryString ? `?${queryString}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      throw new Error(await extractDaytonaError(response, 'Failed to list sandboxes'))
    }
    const data = await response.json()
    const items = Array.isArray(data?.items) ? data.items : []
    return {
      success: true,
      output: {
        sandboxes: items.map(mapDaytonaSandbox),
        nextCursor: data?.nextCursor ?? null,
      },
    }
  },

  outputs: {
    sandboxes: {
      type: 'array',
      description: 'Sandboxes in the organization',
      items: {
        type: 'json',
        properties: DAYTONA_SANDBOX_OUTPUT_PROPERTIES,
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page of results',
      optional: true,
    },
  },
}
