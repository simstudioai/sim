import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookFundSearchParams, PitchbookSearchResponse } from '@/tools/pitchbook/types'
import {
  buildSearchQuery,
  mapStats,
  PITCHBOOK_API_BASE,
  pitchbookAuthHeaders,
  throwIfNotOk,
} from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookFundSearchTool: ToolConfig<
  PitchbookFundSearchParams,
  PitchbookSearchResponse
> = {
  id: 'pitchbook_fund_search',
  name: 'PitchBook Fund Search',
  description: 'Search PitchBook for funds by manager, type, size, vintage, and performance',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PitchBook API key',
    },
    fundNames: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated fund names or PitchBook fund IDs',
    },
    investorNames: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated names or PitchBook IDs of the fund managers',
    },
    fundType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'PitchBook fund type code',
    },
    fundSize: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Fund size in millions. Use >500, <500, or 1^5000 for a range',
    },
    dryPowder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Dry powder in millions. Use >500, <500, or 1^500 for a range',
    },
    vintage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Vintage year. Use >2015, <2015, or 2015^2020 for a range',
    },
    city: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'City the fund is located in',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country the fund is located in (e.g. USA)',
    },
    irr: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Internal rate of return as a percentage. Use >20, <20, or 10^20 for a range',
    },
    tvpi: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Total value to paid-in multiple. Use >2, <2, or 1^2 for a range',
    },
    dpi: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Distributions to paid-in multiple. Use >1, <1, or 1^2 for a range',
    },
    industryPreferences: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Preferred industry codes the fund targets',
    },
    geographicalPreferences: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Preferred geography codes the fund targets',
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
          fundNames: params.fundNames,
          investorNames: params.investorNames,
          fundType: params.fundType,
          fundSize: params.fundSize,
          dryPowder: params.dryPowder,
          vintage: params.vintage,
          city: params.city,
          country: params.country,
          irr: params.irr,
          tvpi: params.tvpi,
          dpi: params.dpi,
          industryPreferences: params.industryPreferences,
          geographicalPreferences: params.geographicalPreferences,
          currency: params.filterCurrency,
        },
        {
          page: params.page,
          perPage: params.perPage,
          additionalFilters: params.additionalFilters,
        }
      )
      return `${PITCHBOOK_API_BASE}/funds/search${query ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to search funds')
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
      description: 'Funds matching the search criteria',
      items: {
        type: 'object',
        properties: {
          fundId: { type: 'string', description: 'PitchBook fund ID' },
          fundName: { type: 'string', description: 'Fund name' },
          investors: {
            type: 'array',
            description: 'Managers of the fund',
            items: {
              type: 'object',
              properties: {
                investorId: { type: 'string', description: 'PitchBook investor ID' },
                investorName: { type: 'string', description: 'Investor name' },
              },
            },
          },
        },
      },
    },
  },
}
