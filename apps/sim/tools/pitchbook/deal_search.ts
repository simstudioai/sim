import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookDealSearchParams, PitchbookSearchResponse } from '@/tools/pitchbook/types'
import {
  buildSearchQuery,
  mapStats,
  PITCHBOOK_API_BASE,
  pitchbookAuthHeaders,
  throwIfNotOk,
} from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookDealSearchTool: ToolConfig<
  PitchbookDealSearchParams,
  PitchbookSearchResponse
> = {
  id: 'pitchbook_deal_search',
  name: 'PitchBook Deal Search',
  description:
    'Search PitchBook for deals by company, investor, deal type, size, date, and valuation',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PitchBook API key',
    },
    companyNames: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated company names, PitchBook IDs, websites, or tickers',
    },
    investorNames: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated investor names, PitchBook IDs, websites, or tickers',
    },
    keywords: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Keywords associated with the companies involved',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country of the companies involved (e.g. USA)',
    },
    locationType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict location matching to HQ_ONLY, NON_HQ_ONLY, or ANY',
    },
    industry: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'PitchBook industry code of the companies involved',
    },
    verticals: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'PitchBook vertical code of the companies involved',
    },
    dealType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'PitchBook deal type code (e.g. evc for early-stage VC)',
    },
    dealStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Deal status code, distinguishing completed, failed, and upcoming deals',
    },
    dealSize: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Deal size in millions. Use >100, <100, or 10^100 for a range',
    },
    dealDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Deal date filter. Use >YYYY-MM-DD, <YYYY-MM-DD, or YYYY-MM-DD^YYYY-MM-DD for a range',
    },
    postValuation: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Post-money valuation in millions. Use >100, <100, or 10^100 for a range',
    },
    revenue: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Revenue of the companies involved in millions. Use >100, <100, or 10^100 for a range',
    },
    filterCurrency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ISO currency code the monetary filters on this search are expressed in, e.g. setting EUR means dealSize is read as millions of euros. Distinct from `currency`, which converts the values PitchBook returns.',
    },
    currency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ISO currency code to convert monetary values into, sent as the X-Currency header (e.g. USD, EUR, JPY). Defaults to the currency on the account preferences.',
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
      description: 'How many results to return per page',
    },
    additionalFilters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Any other documented search filter, as a JSON object of query parameter names to values (e.g. {"emergingSpaces": "AGTECH"}). A dedicated field always wins over the same key set here.',
    },
  },

  request: {
    url: (params) => {
      const query = buildSearchQuery(
        {
          companyNames: params.companyNames,
          investorNames: params.investorNames,
          keywords: params.keywords,
          country: params.country,
          locationType: params.locationType,
          industry: params.industry,
          verticals: params.verticals,
          dealType: params.dealType,
          dealStatus: params.dealStatus,
          dealSize: params.dealSize,
          dealDate: params.dealDate,
          postValuation: params.postValuation,
          revenue: params.revenue,
          currency: params.filterCurrency,
        },
        {
          page: params.page,
          perPage: params.perPage,
          additionalFilters: params.additionalFilters,
        }
      )
      return `${PITCHBOOK_API_BASE}/deals/search${query ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to search deals')
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
      description: 'Paging envelope for the result set',
      properties: {
        total: { type: 'number', description: 'Total number of matching results' },
        perPage: { type: 'number', description: 'Results returned per page' },
        page: { type: 'number', description: 'Current page number' },
        lastPage: { type: 'number', description: 'Number of the last available page' },
      },
    },
    items: {
      type: 'array',
      description: 'Deals matching the search criteria',
      items: {
        type: 'object',
        properties: {
          dealId: { type: 'string', description: 'PitchBook deal ID' },
          companyId: { type: 'string', description: 'PitchBook ID of the company in the deal' },
          companyName: { type: 'string', description: 'Name of the company in the deal' },
        },
      },
    },
  },
}
