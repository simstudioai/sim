import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookResponse, PitchbookSharedSearchParams } from '@/tools/pitchbook/types'
import {
  mapStats,
  PITCHBOOK_API_BASE,
  pitchbookAuthHeaders,
  throwIfNotOk,
} from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookSharedSearchTool: ToolConfig<PitchbookSharedSearchParams, PitchbookResponse> =
  {
    id: 'pitchbook_shared_search',
    name: 'PitchBook Shared Search',
    description:
      'Extract the names and PitchBook IDs behind an Advanced Search shared from the PitchBook platform, using the search ID and hash from the shared link',
    version: '1.0.0',
    errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'PitchBook API key',
      },
      entityType: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Entity type the shared search returns: COMPANIES, DEALS, INVESTORS, SERVICE_PROVIDERS, LIMITED_PARTNERS, PEOPLE, ENTITY_MANAGEMENT, or FUNDS',
      },
      searchId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Search ID from the shared link, the path segment after /search/ (e.g. 8e6bd17e-dea5-4eca-8143-dddb2ab623a0)',
      },
      hash: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Hash query parameter from the shared link',
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
        qs.set('searchId', params.searchId.trim())
        qs.set('hash', params.hash.trim())
        if (params.page !== undefined && params.page !== null) qs.set('page', String(params.page))
        if (params.perPage !== undefined && params.perPage !== null) {
          qs.set('perPage', String(params.perPage))
        }
        return `${PITCHBOOK_API_BASE}/${params.entityType.trim()}/search?${qs.toString()}`
      },
      method: 'GET',
      headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
    },

    transformResponse: async (response: Response) => {
      await throwIfNotOk(response, 'Failed to run shared search')
      const data = await response.json()

      return {
        success: true,
        output: {
          stats: mapStats(data.stats),
          searchCriteria: data.searchCriteria ?? null,
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
      searchCriteria: { type: 'string', description: 'Criteria of the shared search' },
      items: {
        type: 'array',
        description: 'Records returned',
        items: {
          type: 'object',
          properties: {
            companyId: { type: 'string', description: 'PitchBook company ID' },
            companyName: { type: 'string', description: 'Company name' },
            website: { type: 'string', description: 'Website' },
          },
        },
      },
    },
  }
