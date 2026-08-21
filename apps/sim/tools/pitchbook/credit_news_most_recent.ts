import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookCreditNewsRecentParams, PitchbookResponse } from '@/tools/pitchbook/types'
import {
  mapStats,
  PITCHBOOK_API_BASE,
  pitchbookAuthHeaders,
  throwIfNotOk,
} from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookCreditNewsMostRecentTool: ToolConfig<
  PitchbookCreditNewsRecentParams,
  PitchbookResponse
> = {
  id: 'pitchbook_credit_news_most_recent',
  name: 'PitchBook Most Recent Credit News',
  description:
    'Retrieve the most recently published credit analysis articles and their descriptions, without article bodies',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PitchBook API key',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Page of results to return, starting at 1. Increment it to reach older articles.',
    },
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'How many results to return per page, between 1 and 250. Defaults to 25.',
    },
    currency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ISO currency code to convert monetary values into, sent as the X-Currency header (e.g. USD, EUR, JPY). Defaults to the currency on the account preferences.',
    },
  },

  request: {
    url: (params) => {
      const qs = new URLSearchParams()
      if (params.page !== undefined && params.page !== null) qs.set('page', String(params.page))
      if (params.perPage !== undefined && params.perPage !== null) {
        qs.set('perPage', String(params.perPage))
      }
      const query = qs.toString()
      return `${PITCHBOOK_API_BASE}/credit-analysis/credit-news/most-recent${query ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch most recent credit news')
    const data = await response.json()

    return {
      success: true,
      output: {
        stats: mapStats(data.stats),
        items: data.items ?? [],
      },
    }
  },

  outputs: {
    stats: {
      type: 'object',
      description: 'Summary statistics for the response',
      properties: {
        total: { type: 'number', description: 'Total number of matching results' },
        perPage: { type: 'number', description: 'Results returned per page' },
        page: { type: 'number', description: 'Current page number' },
        lastPage: { type: 'number', description: 'Number of the last available page' },
      },
    },
    items: {
      type: 'array',
      description: 'Records returned',
      items: {
        type: 'object',
        properties: {
          articleId: { type: 'number', description: 'Credit news article ID' },
          title: { type: 'string', description: 'Title' },
          authors: {
            type: 'array',
            description: 'Authors of the article',
            items: {
              type: 'object',
              properties: {
                authorName: { type: 'string', description: 'Author name' },
              },
            },
          },
          regions: {
            type: 'array',
            description: 'Geographic regions the article covers',
            items: { type: 'string' },
          },
          publishDate: { type: 'string', description: 'Publication timestamp (ISO 8601)' },
          assetClasses: {
            type: 'array',
            description: 'Asset classes the article covers',
            items: { type: 'string' },
          },
          topics: {
            type: 'array',
            description: 'Topics the article covers',
            items: { type: 'string' },
          },
          issuer: {
            type: 'object',
            description: 'Issuer the article is about',
            nullable: true,
            properties: {
              pbId: { type: 'string', description: 'PitchBook entity ID' },
              name: { type: 'string', description: 'Name' },
            },
          },
          lender: {
            type: 'object',
            description: 'Lender the article is about',
            nullable: true,
            properties: {
              pbId: { type: 'string', description: 'PitchBook entity ID' },
              name: { type: 'string', description: 'Name' },
            },
          },
          sponsor: {
            type: 'object',
            description: 'Sponsor the article is about',
            nullable: true,
            properties: {
              pbId: { type: 'string', description: 'PitchBook entity ID' },
              name: { type: 'string', description: 'Name' },
            },
          },
        },
      },
    },
  },
}
