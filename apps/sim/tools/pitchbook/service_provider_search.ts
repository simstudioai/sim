import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  PitchbookSearchResponse,
  PitchbookServiceProviderSearchParams,
} from '@/tools/pitchbook/types'
import {
  buildSearchQuery,
  mapStats,
  PITCHBOOK_API_BASE,
  pitchbookAuthHeaders,
  throwIfNotOk,
} from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookServiceProviderSearchTool: ToolConfig<
  PitchbookServiceProviderSearchParams,
  PitchbookSearchResponse
> = {
  id: 'pitchbook_service_provider_search',
  name: 'PitchBook Service Provider Search',
  description:
    'Search PitchBook for service providers by type, location, and the deals they have worked on',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PitchBook API key',
    },
    serviceProviderNames: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated service provider names or PitchBook IDs',
    },
    serviceProviderType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'PitchBook service provider type code',
    },
    city: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'City the service provider is located in',
    },
    stateProvince: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'State or province the service provider is located in',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country the service provider is located in (e.g. USA)',
    },
    locationType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict location matching to HQ_ONLY, NON_HQ_ONLY, or ANY',
    },
    numberOfDeals: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of deals worked on. Use >50, <50, or 10^50 for a range',
    },
    dealType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'PitchBook deal type code of the deals worked on',
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
      description: 'Deal size in millions. Use >450, <450, or 10^450 for a range',
    },
    serviceTypesOnDeal: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Service type codes provided on the deal',
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
          serviceProviderNames: params.serviceProviderNames,
          serviceProviderType: params.serviceProviderType,
          city: params.city,
          stateProvince: params.stateProvince,
          country: params.country,
          locationType: params.locationType,
          numberOfDeals: params.numberOfDeals,
          dealType: params.dealType,
          dealDate: params.dealDate,
          dealSize: params.dealSize,
          serviceTypesOnDeal: params.serviceTypesOnDeal,
        },
        {
          page: params.page,
          perPage: params.perPage,
          additionalFilters: params.additionalFilters,
        }
      )
      return `${PITCHBOOK_API_BASE}/service-providers/search${query ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to search service providers')
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
      description: 'Service providers matching the search criteria',
      items: {
        type: 'object',
        properties: {
          serviceProviderId: { type: 'string', description: 'PitchBook service provider ID' },
          serviceProviderName: { type: 'string', description: 'Service provider name' },
          website: { type: 'string', description: 'Service provider website', nullable: true },
        },
      },
    },
  },
}
