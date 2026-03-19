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
      offerStatus: string
      acceptanceStatus: string | null
      applicationId: string | null
      startDate: string | null
      salary: {
        currencyCode: string
        value: number
      } | null
      openingId: string | null
      createdAt: string | null
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
              latestVersion?: {
                startDate?: string
                salary?: { currencyCode?: string; value?: number }
                openingId?: string
                createdAt?: string
              }
            }
          ) => {
            const v = o.latestVersion
            return {
              id: o.id ?? null,
              offerStatus: o.offerStatus ?? null,
              acceptanceStatus: o.acceptanceStatus ?? null,
              applicationId: o.applicationId ?? null,
              startDate: v?.startDate ?? null,
              salary: v?.salary
                ? {
                    currencyCode: v.salary.currencyCode ?? null,
                    value: v.salary.value ?? null,
                  }
                : null,
              openingId: v?.openingId ?? null,
              createdAt: v?.createdAt ?? null,
            }
          }
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
          offerStatus: { type: 'string', description: 'Offer status' },
          acceptanceStatus: { type: 'string', description: 'Acceptance status', optional: true },
          applicationId: {
            type: 'string',
            description: 'Associated application UUID',
            optional: true,
          },
          startDate: { type: 'string', description: 'Offer start date', optional: true },
          salary: {
            type: 'object',
            description: 'Salary details',
            optional: true,
            properties: {
              currencyCode: { type: 'string', description: 'ISO 4217 currency code' },
              value: { type: 'number', description: 'Salary amount' },
            },
          },
          openingId: { type: 'string', description: 'Associated opening UUID', optional: true },
          createdAt: { type: 'string', description: 'ISO 8601 creation timestamp', optional: true },
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
