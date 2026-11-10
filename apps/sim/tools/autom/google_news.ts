import { toBooleanOrNull } from '@sim/utils/coerce'
import { toArray, toRecord } from '@sim/utils/object'
import type {
  AutomGoogleNewsParams,
  AutomGoogleNewsResponse,
  AutomSearchResult,
} from '@/tools/autom/types'
import { AUTOM_SEARCH_RESULT_OUTPUT_PROPERTIES } from '@/tools/autom/types'
import { mapAutomSearchResult } from '@/tools/autom/utils'
import type { ToolConfig } from '@/tools/types'

export const automGoogleNewsTool: ToolConfig<AutomGoogleNewsParams, AutomGoogleNewsResponse> = {
  id: 'autom_google_news',
  name: 'Autom Google News',
  description: 'Search Google News and get articles with title, source, date, link and snippet.',
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
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page of results, starting at 1',
    },
    numResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (e.g., 10)',
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
      const url = new URL(`https://api.autom.dev/v1/google/news`)
      url.searchParams.set('query', params.query.trim())
      if (params.country?.trim()) url.searchParams.set('gl', params.country.trim())
      if (params.language?.trim()) url.searchParams.set('hl', params.language.trim())
      if (params.page != null) url.searchParams.set('page', String(params.page))
      if (params.numResults != null) url.searchParams.set('num', String(params.numResults))
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
        hasNextPage: toBooleanOrNull(toRecord(data.pagination).has_next_page),
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'News articles',
      optional: true,
      items: { type: 'object', properties: AUTOM_SEARCH_RESULT_OUTPUT_PROPERTIES },
    },
    hasNextPage: {
      type: 'boolean',
      description: 'Whether another page of results exists',
      optional: true,
    },
  },
}
