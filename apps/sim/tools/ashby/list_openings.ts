import type { AshbyOpening } from '@/tools/ashby/types'
import {
  ashbyAuthHeaders,
  ashbyErrorMessage,
  ashbyLimit,
  ashbyTimestamp,
  mapOpenings,
  OPENINGS_OUTPUT,
} from '@/tools/ashby/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyListOpeningsParams {
  apiKey: string
  cursor?: string
  perPage?: number
  createdAfter?: string
  syncToken?: string
}

interface AshbyListOpeningsResponse extends ToolResponse {
  output: {
    openings: AshbyOpening[]
    moreDataAvailable: boolean
    nextCursor: string | null
    nextSyncCursor: string | null
  }
}

export const listOpeningsTool: ToolConfig<AshbyListOpeningsParams, AshbyListOpeningsResponse> = {
  id: 'ashby_list_openings',
  name: 'Ashby List Openings',
  description: 'Lists all openings in Ashby with pagination.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque pagination cursor from a previous response nextCursor value',
    },
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (default 100)',
    },
    createdAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only return openings created after this ISO 8601 timestamp (e.g. 2024-01-01T00:00:00Z)',
    },
    syncToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque token from a completed prior sync run',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/opening.list',
    method: 'POST',
    headers: (params) => ashbyAuthHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.cursor) body.cursor = params.cursor
      const limit = ashbyLimit(params.perPage)
      if (limit) body.limit = limit
      if (params.createdAfter)
        body.createdAfter = ashbyTimestamp(params.createdAfter, 'createdAfter')
      if (params.syncToken) body.syncToken = params.syncToken
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(ashbyErrorMessage(data, 'Failed to list openings'))
    }

    return {
      success: true,
      output: {
        openings: mapOpenings(data.results),
        moreDataAvailable: data.moreDataAvailable ?? false,
        nextCursor: data.nextCursor ?? null,
        nextSyncCursor: data.syncToken ?? null,
      },
    }
  },

  outputs: {
    openings: OPENINGS_OUTPUT,
    moreDataAvailable: {
      type: 'boolean',
      description: 'Whether more pages of results exist',
    },
    nextCursor: {
      type: 'string',
      description: 'Opaque cursor for fetching the next page',
      optional: true,
    },
    nextSyncCursor: {
      type: 'string',
      description: 'Opaque token for the next incremental sync',
      optional: true,
    },
  },
}
