import { toArray, toRecord } from '@sim/utils/object'
import type {
  AutomGoogleSearchLightParams,
  AutomGoogleSearchLightResponse,
  AutomSearchResult,
} from '@/tools/autom/types'
import { AUTOM_SEARCH_RESULT_OUTPUT_PROPERTIES } from '@/tools/autom/types'
import { mapAutomSearchResult } from '@/tools/autom/utils'
import type { ToolConfig } from '@/tools/types'

export const automGoogleSearchLightTool: ToolConfig<
  AutomGoogleSearchLightParams,
  AutomGoogleSearchLightResponse
> = {
  id: 'autom_google_search_light',
  name: 'Autom Google Search (Organic Only)',
  description:
    'Search Google and get only the organic results, the fastest and cheapest Google search.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query (e.g., "best electric cars")',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Two-letter country code to search from (e.g., "us")',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Two-letter language code of the results (e.g., "en")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Autom API key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://api.autom.dev/v1/google/search/light`)
      url.searchParams.set('query', params.query.trim())
      if (params.country?.trim()) url.searchParams.set('gl', params.country.trim())
      if (params.language?.trim()) url.searchParams.set('hl', params.language.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'x-api-key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        results: toArray(data.organic_results)
          .map(mapAutomSearchResult)
          .filter((item): item is AutomSearchResult => item !== null),
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Organic results',
      optional: true,
      items: { type: 'object', properties: AUTOM_SEARCH_RESULT_OUTPUT_PROPERTIES },
    },
  },
}
