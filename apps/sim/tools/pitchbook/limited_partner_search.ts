import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  PitchbookLimitedPartnerSearchParams,
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

export const pitchbookLimitedPartnerSearchTool: ToolConfig<
  PitchbookLimitedPartnerSearchParams,
  PitchbookSearchResponse
> = {
  id: 'pitchbook_limited_partner_search',
  name: 'PitchBook Limited Partner Search',
  description:
    'Search PitchBook for limited partners by type, location, assets under management, and commitment activity',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PitchBook API key',
    },
    limitedPartnerNames: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated limited partner names or PitchBook IDs',
    },
    limitedPartnerType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'PitchBook limited partner type code',
    },
    city: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'City the limited partner is located in',
    },
    stateProvince: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'State or province the limited partner is located in',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country the limited partner is located in (e.g. USA)',
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
    numberOfCommitments: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of fund commitments. Use >1000, <1000, or 10^100 for a range',
    },
    commitmentSize: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Commitment size in millions. Use >100, <100, or 10^100 for a range',
    },
    commitmentDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Commitment date filter. Use >YYYY-MM-DD, <YYYY-MM-DD, or YYYY-MM-DD^YYYY-MM-DD for a range',
    },
    fundType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'PitchBook fund type code the limited partner commits to',
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
          limitedPartnerNames: params.limitedPartnerNames,
          limitedPartnerType: params.limitedPartnerType,
          city: params.city,
          stateProvince: params.stateProvince,
          country: params.country,
          locationType: params.locationType,
          aum: params.aum,
          numberOfCommitments: params.numberOfCommitments,
          commitmentSize: params.commitmentSize,
          commitmentDate: params.commitmentDate,
          fundType: params.fundType,
          currency: params.filterCurrency,
        },
        {
          page: params.page,
          perPage: params.perPage,
          additionalFilters: params.additionalFilters,
        }
      )
      return `${PITCHBOOK_API_BASE}/limited-partners/search${query ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to search limited partners')
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
      description: 'Limited partners matching the search criteria',
      items: {
        type: 'object',
        properties: {
          limitedPartnerId: { type: 'string', description: 'PitchBook limited partner ID' },
          limitedPartnerName: { type: 'string', description: 'Limited partner name' },
          website: { type: 'string', description: 'Limited partner website', nullable: true },
        },
      },
    },
  },
}
