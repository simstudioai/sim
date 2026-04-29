import type { AshbyOffer } from '@/tools/ashby/types'
import { ashbyAuthHeaders, ashbyErrorMessage, mapOffer, OFFER_OUTPUTS } from '@/tools/ashby/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyListOffersParams {
  apiKey: string
  cursor?: string
  perPage?: number
  syncToken?: string
  createdAfter?: string
  applicationId?: string
}

interface AshbyListOffersResponse extends ToolResponse {
  output: {
    offers: AshbyOffer[]
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
    createdAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only return offers created after this ISO 8601 timestamp (e.g. 2024-01-01T00:00:00Z)',
    },
    syncToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque token from a prior sync to fetch only items changed since then',
    },
    applicationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only offers for the specified application UUID',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/offer.list',
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
      if (params.syncToken) body.syncToken = params.syncToken
      if (params.applicationId) body.applicationId = params.applicationId.trim()
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(ashbyErrorMessage(data, 'Failed to list offers'))
    }

    return {
      success: true,
      output: {
        offers: (data.results ?? []).map(mapOffer),
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
        properties: OFFER_OUTPUTS,
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
