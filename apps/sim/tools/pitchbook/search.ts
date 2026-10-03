import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookGeneralSearchParams, PitchbookSearchResponse } from '@/tools/pitchbook/types'
import {
  buildSearchQuery,
  mapStats,
  PITCHBOOK_API_BASE,
  pitchbookAuthHeaders,
  throwIfNotOk,
} from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookSearchTool: ToolConfig<
  PitchbookGeneralSearchParams,
  PitchbookSearchResponse
> = {
  id: 'pitchbook_search',
  name: 'PitchBook Search',
  description:
    'Search across every PitchBook entity type at once by name, PitchBook ID, website, or ticker. Use this to resolve a company, investor, or fund to its PitchBook ID before calling a profile operation.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PitchBook API key',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'What to look up: an entity name, a PitchBook ID, a website, a ticker, or an exchange-qualified ticker. Names and websites match partially once the term is long enough; IDs and tickers match exactly.',
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
  },

  request: {
    url: (params) => {
      const query = buildSearchQuery(
        { query: params.query },
        { page: params.page, perPage: params.perPage }
      )
      return `${PITCHBOOK_API_BASE}/search?${query}`
    },
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to run PitchBook search')
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
      description:
        'Matching entities. Entries carry pbId/name for companies, investors, and service providers, and fundId/fundName for funds, so check which is populated before using an ID.',
      items: {
        type: 'object',
        properties: {
          pbId: {
            type: 'string',
            description: 'PitchBook entity ID, null for fund results',
            nullable: true,
          },
          name: {
            type: 'string',
            description: 'Entity name, null for fund results',
            nullable: true,
          },
          fundId: {
            type: 'string',
            description: 'PitchBook fund ID, present only on fund results',
            optional: true,
            nullable: true,
          },
          fundName: {
            type: 'string',
            description: 'Fund name, present only on fund results',
            optional: true,
            nullable: true,
          },
          website: {
            type: 'string',
            description: 'Entity website, absent on fund results',
            optional: true,
            nullable: true,
          },
          pitchBookProfileLink: {
            type: 'string',
            description: 'Link to the entity profile in the PitchBook platform',
            optional: true,
            nullable: true,
          },
          primaryFirmType: {
            type: 'object',
            description: 'Primary type of the entity',
            optional: true,
            nullable: true,
            properties: {
              pbId: { type: 'string', description: 'PitchBook entity ID' },
              type: { type: 'string', description: 'Entity type (e.g. COMPANY, INVESTOR)' },
            },
          },
          otherFirmTypes: {
            type: 'array',
            description: 'Additional types the entity is also classified as',
            optional: true,
            items: {
              type: 'object',
              properties: {
                pbId: { type: 'string', description: 'PitchBook entity ID' },
                type: { type: 'string', description: 'Entity type (e.g. COMPANY, INVESTOR)' },
              },
            },
          },
          stockTicker: {
            type: 'string',
            description: 'Stock ticker when the entity is publicly traded',
            optional: true,
            nullable: true,
          },
        },
      },
    },
  },
}
