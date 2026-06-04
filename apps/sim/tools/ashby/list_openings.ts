import type { AshbyOpening } from '@/tools/ashby/types'
import {
  ashbyAuthHeaders,
  ashbyErrorMessage,
  mapOpenings,
  OPENINGS_OUTPUT,
} from '@/tools/ashby/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyListOpeningsParams {
  apiKey: string
  cursor?: string
  perPage?: number
  createdAfter?: string
}

interface AshbyListOpeningsResponse extends ToolResponse {
  output: {
    openings: AshbyOpening[]
    moreDataAvailable: boolean
    nextCursor: string | null
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
  },

  request: {
    url: 'https://api.ashbyhq.com/opening.list',
    method: 'POST',
    headers: (params) => ashbyAuthHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.cursor) body.cursor = params.cursor
      if (params.perPage) body.limit = params.perPage
      if (params.createdAfter) {
        const ms = new Date(params.createdAfter).getTime()
        if (!Number.isNaN(ms)) body.createdAfter = ms
      }
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
  },
}
