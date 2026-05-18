import {
  extractProspeoError,
  type ProspeoSearchSuggestionsParams,
  type ProspeoSearchSuggestionsResponse,
} from '@/tools/prospeo/types'
import type { ToolConfig } from '@/tools/types'

export const searchSuggestionsTool: ToolConfig<
  ProspeoSearchSuggestionsParams,
  ProspeoSearchSuggestionsResponse
> = {
  id: 'prospeo_search_suggestions',
  name: 'Prospeo Search Suggestions',
  description:
    'Free endpoint to retrieve valid location or job title values for use in Search filters. Provide exactly one of location_search or job_title_search.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Prospeo API key',
    },
    location_search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Search query for location suggestions (minimum 2 characters). Mutually exclusive with job_title_search.',
    },
    job_title_search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Search query for job title suggestions (minimum 2 characters). Mutually exclusive with location_search.',
    },
  },

  request: {
    url: 'https://api.prospeo.io/search-suggestions',
    method: 'POST',
    headers: (params) => ({
      'X-KEY': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.location_search) body.location_search = params.location_search
      if (params.job_title_search) body.job_title_search = params.job_title_search
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await extractProspeoError(response))
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        location_suggestions: data.location_suggestions ?? null,
        job_title_suggestions: data.job_title_suggestions ?? null,
      },
    }
  },

  outputs: {
    location_suggestions: {
      type: 'array',
      description:
        'Location suggestions when using location_search (null when searching job titles)',
      optional: true,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Formatted location name to use in filters' },
          type: {
            type: 'string',
            description: 'Location type (COUNTRY, STATE, CITY, or ZONE)',
          },
        },
      },
    },
    job_title_suggestions: {
      type: 'array',
      description:
        'Up to 25 job title suggestions ordered by popularity when using job_title_search (null when searching locations)',
      optional: true,
      items: { type: 'string' },
    },
  },
}
