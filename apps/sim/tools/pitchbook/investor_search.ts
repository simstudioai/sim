import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  PitchbookInvestorSearchParams,
  PitchbookSearchResponse,
} from '@/tools/pitchbook/types'
import {
  buildSearchQuery,
  mapStats,
  PITCHBOOK_API_BASE,
  pitchbookAuthHeaders,
  throwIfNotOk,
} from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookInvestorSearchTool: ToolConfig<
  PitchbookInvestorSearchParams,
  PitchbookSearchResponse
> = {
  id: 'pitchbook_investor_search',
  name: 'PitchBook Investor Search',
  description:
    'Search PitchBook for investors by type, location, assets under management, fund profile, and deal activity',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PitchBook API key',
    },
    investorNames: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated investor names, PitchBook IDs, websites, or tickers',
    },
    investorType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'PitchBook investor type code (e.g. LP_BI, LP_E)',
    },
    city: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'City the investor is located in',
    },
    stateProvince: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'State or province the investor is located in',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country the investor is located in (e.g. USA)',
    },
    locationType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict location matching to HQ_ONLY, NON_HQ_ONLY, or ANY',
    },
    aum: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Assets under management in millions. Use >1000, <1000, or 100^1000 for a range',
    },
    dryPowder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Dry powder in millions. Use >500, <500, or 1^500 for a range',
    },
    fundType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'PitchBook fund type code of the investor funds',
    },
    fundSize: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Fund size in millions. Use >500, <500, or 1^500 for a range',
    },
    dealType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'PitchBook deal type code the investor has participated in',
    },
    dealDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Deal date filter. Use >YYYY-MM-DD, <YYYY-MM-DD, or YYYY-MM-DD^YYYY-MM-DD for a range',
    },
    dealSize: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Deal size in millions. Use >100, <100, or 10^100 for a range',
    },
    preferredDealTypes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Preferred deal type codes the investor targets',
    },
    industryPreferences: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Preferred industry codes the investor targets',
    },
    geographicalPreferences: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Preferred geography codes the investor targets',
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
          investorNames: params.investorNames,
          investorType: params.investorType,
          city: params.city,
          stateProvince: params.stateProvince,
          country: params.country,
          locationType: params.locationType,
          aum: params.aum,
          dryPowder: params.dryPowder,
          fundType: params.fundType,
          fundSize: params.fundSize,
          dealType: params.dealType,
          dealDate: params.dealDate,
          dealSize: params.dealSize,
          preferredDealTypes: params.preferredDealTypes,
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
      return `${PITCHBOOK_API_BASE}/investors/search${query ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to search investors')
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
      description: 'Investors matching the search criteria',
      items: {
        type: 'object',
        properties: {
          investorId: { type: 'string', description: 'PitchBook investor ID' },
          investorName: { type: 'string', description: 'Investor name' },
          website: { type: 'string', description: 'Investor website', nullable: true },
        },
      },
    },
  },
}
