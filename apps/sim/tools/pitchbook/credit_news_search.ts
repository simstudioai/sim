import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookCreditNewsSearchParams, PitchbookResponse } from '@/tools/pitchbook/types'
import {
  mapStats,
  PITCHBOOK_API_BASE,
  pitchbookAuthHeaders,
  throwIfNotOk,
} from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookCreditNewsSearchTool: ToolConfig<
  PitchbookCreditNewsSearchParams,
  PitchbookResponse
> = {
  id: 'pitchbook_credit_news_search',
  name: 'PitchBook Credit News Search',
  description:
    'Search PitchBook credit analysis news by author, region, asset class, topic, issuer, lender, sponsor, and date',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PitchBook API key',
    },
    authors: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Article author name. Separate multiple values with a comma.',
    },
    regions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Region the article covers: United States or Europe.',
    },
    assetClasses: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Asset class the article covers. Separate multiple values with a comma.',
    },
    topics: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Topic the article covers. Separate multiple values with a comma.',
    },
    issuer: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Issuer name. Separate multiple values with a comma.',
    },
    lender: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lender name. Separate multiple values with a comma.',
    },
    sponsor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sponsor name. Separate multiple values with a comma.',
    },
    sinceDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Publication date filter. Use >YYYY-MM-DD, <YYYY-MM-DD, or YYYY-MM-DD^YYYY-MM-DD for a range.',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page of results to return, starting at 1',
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
      if (params.authors) qs.set('authors', params.authors)
      if (params.regions) qs.set('regions', params.regions)
      if (params.assetClasses) qs.set('assetClasses', params.assetClasses)
      if (params.topics) qs.set('topics', params.topics)
      if (params.issuer) qs.set('issuer', params.issuer)
      if (params.lender) qs.set('lender', params.lender)
      if (params.sponsor) qs.set('sponsor', params.sponsor)
      if (params.sinceDate) qs.set('sinceDate', params.sinceDate)
      if (params.page !== undefined && params.page !== null) qs.set('page', String(params.page))
      if (params.perPage !== undefined && params.perPage !== null) {
        qs.set('perPage', String(params.perPage))
      }
      const query = qs.toString()
      return `${PITCHBOOK_API_BASE}/credit-analysis/credit-news/search${query ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to search credit news')
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
