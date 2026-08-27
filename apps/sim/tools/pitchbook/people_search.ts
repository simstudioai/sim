import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookPeopleSearchParams, PitchbookSearchResponse } from '@/tools/pitchbook/types'
import {
  buildSearchQuery,
  mapStats,
  PITCHBOOK_API_BASE,
  pitchbookAuthHeaders,
  throwIfNotOk,
} from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookPeopleSearchTool: ToolConfig<
  PitchbookPeopleSearchParams,
  PitchbookSearchResponse
> = {
  id: 'pitchbook_people_search',
  name: 'PitchBook People Search',
  description: 'Search PitchBook for people by name, employer, position, education, and location',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PitchBook API key',
    },
    personNames: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated person names or PitchBook person IDs',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name of the person',
    },
    lastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name of the person',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address of the person',
    },
    firmNames: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated firm names, PitchBook IDs, websites, or tickers the person is associated with',
    },
    firmType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'PitchBook firm type code of the associated firm',
    },
    positionLevel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated position level codes (e.g. CEO, CFO, CIO)',
    },
    positionTitle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Position title to match (e.g. Chief Executive Officer)',
    },
    department: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Department code the person works in',
    },
    university: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'University the person attended',
    },
    biography: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Keywords appearing in the person biography',
    },
    city: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'City the person is located in',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country the person is located in (e.g. USA)',
    },
    industry: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'PitchBook industry code of the associated firm',
    },
    verticals: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'PitchBook vertical code of the associated firm',
    },
    primaryPositionOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only match the person primary position rather than any position they hold',
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
          personNames: params.personNames,
          firstName: params.firstName,
          lastName: params.lastName,
          email: params.email,
          firmNames: params.firmNames,
          firmType: params.firmType,
          positionLevel: params.positionLevel,
          positionTitle: params.positionTitle,
          department: params.department,
          university: params.university,
          biography: params.biography,
          city: params.city,
          country: params.country,
          industry: params.industry,
          verticals: params.verticals,
          primaryPositionOnly: params.primaryPositionOnly,
        },
        {
          page: params.page,
          perPage: params.perPage,
          additionalFilters: params.additionalFilters,
        }
      )
      return `${PITCHBOOK_API_BASE}/people/search${query ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to search people')
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
      description: 'People matching the search criteria',
      items: {
        type: 'object',
        properties: {
          personId: { type: 'string', description: 'PitchBook person ID' },
          personName: { type: 'string', description: 'Full name of the person' },
          firmId: {
            type: 'string',
            description: 'PitchBook ID of the firm the person is associated with',
            nullable: true,
          },
        },
      },
    },
  },
}
