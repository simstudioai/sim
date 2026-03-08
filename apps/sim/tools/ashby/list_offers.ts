import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyListOffersParams {
  apiKey: string
  cursor?: string
  perPage?: number
}

interface AshbyListOffersResponse extends ToolResponse {
  output: {
    offers: Array<{
      id: string
      status: string
      candidate: {
        id: string
        name: string
      } | null
      job: {
        id: string
        title: string
      } | null
      createdAt: string
      updatedAt: string
    }>
    moreDataAvailable: boolean
    nextCursor: string | null
  }
}

export const listOffersTool: ToolConfig<AshbyListOffersParams, AshbyListOffersResponse> = {
  id: 'ashby_list_offers',
  name: 'Ashby List Offers',
  description: 'Lists all offers with their latest version in an Ashby organization.',
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
      description: 'Number of results per page',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/offer.list',
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
      throw new Error(data.errorInfo?.message || 'Failed to list offers')
    }

    return {
      success: true,
      output: {
        offers: (data.results ?? []).map(
          (
            o: Record<string, unknown> & {
              candidate?: { id?: string; name?: string }
              job?: { id?: string; title?: string }
            }
          ) => ({
            id: o.id ?? null,
            status: o.status ?? o.offerStatus ?? null,
            candidate: o.candidate
              ? {
                  id: o.candidate.id ?? null,
                  name: o.candidate.name ?? null,
                }
              : null,
            job: o.job
              ? {
                  id: o.job.id ?? null,
                  title: o.job.title ?? null,
                }
              : null,
            createdAt: o.createdAt ?? null,
            updatedAt: o.updatedAt ?? null,
          })
        ),
        moreDataAvailable: data.moreDataAvailable ?? false,
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    offers: {
      type: 'array',
      description: 'List of offers',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Offer UUID' },
          status: { type: 'string', description: 'Offer status' },
          candidate: {
            type: 'object',
            description: 'Associated candidate',
            optional: true,
            properties: {
              id: { type: 'string', description: 'Candidate UUID' },
              name: { type: 'string', description: 'Candidate name' },
            },
          },
          job: {
            type: 'object',
            description: 'Associated job',
            optional: true,
            properties: {
              id: { type: 'string', description: 'Job UUID' },
              title: { type: 'string', description: 'Job title' },
            },
          },
          createdAt: { type: 'string', description: 'ISO 8601 creation timestamp' },
          updatedAt: { type: 'string', description: 'ISO 8601 last update timestamp' },
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
