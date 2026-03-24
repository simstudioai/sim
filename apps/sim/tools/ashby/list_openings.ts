import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyListOpeningsParams {
  apiKey: string
  cursor?: string
  perPage?: number
}

interface AshbyListOpeningsResponse extends ToolResponse {
  output: {
    openings: Array<{
      id: string
      openingState: string | null
      isArchived: boolean
      openedAt: string | null
      closedAt: string | null
    }>
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
  },

  request: {
    url: 'https://api.ashbyhq.com/opening.list',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.cursor) body.cursor = params.cursor
      if (params.perPage) body.limit = params.perPage
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to list openings')
    }

    return {
      success: true,
      output: {
        openings: (data.results ?? []).map((o: Record<string, unknown>) => ({
          id: o.id ?? null,
          openingState: o.openingState ?? null,
          isArchived: o.isArchived ?? false,
          openedAt: o.openedAt ?? null,
          closedAt: o.closedAt ?? null,
        })),
        moreDataAvailable: data.moreDataAvailable ?? false,
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    openings: {
      type: 'array',
      description: 'List of openings',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Opening UUID' },
          openingState: {
            type: 'string',
            description: 'Opening state (Approved, Closed, Draft, Filled, Open)',
            optional: true,
          },
          isArchived: { type: 'boolean', description: 'Whether the opening is archived' },
          openedAt: { type: 'string', description: 'ISO 8601 opened timestamp', optional: true },
          closedAt: { type: 'string', description: 'ISO 8601 closed timestamp', optional: true },
        },
      },
    },
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
