import type { GoogleSearchParams, GoogleSearchResponse } from '@/tools/google/types'
import {
  GOOGLE_SEARCH_INFORMATION_OUTPUT_PROPERTIES,
  GOOGLE_SEARCH_RESULT_OUTPUT_PROPERTIES,
} from '@/tools/google/types'
import type { ToolConfig } from '@/tools/types'

export const searchTool: ToolConfig<GoogleSearchParams, GoogleSearchResponse> = {
  id: 'google_search',
  name: 'Google Search',
  description: 'Search the web with the Custom Search API',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query to execute',
    },
    searchEngineId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Custom Search Engine ID',
    },
    num: {
      type: 'string', // Treated as string for compatibility with tool interfaces
      required: false,
      visibility: 'user-only',
      description: 'Number of results to return (1-10, default 10)',
    },
    start: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Index of the first result (1-based, for pagination; start + num must be <= 100)',
    },
    dateRestrict: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict results by recency: d[n] days, w[n] weeks, m[n] months, y[n] years',
    },
    fileType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict to a file extension (e.g., pdf, doc)',
    },
    safe: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SafeSearch level: "active" or "off" (default off)',
    },
    searchType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to "image" to perform an image search',
    },
    siteSearch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A site to include or exclude from results',
    },
    siteSearchFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include ("i") or exclude ("e") the siteSearch site',
    },
    lr: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict to a language, e.g. "lang_en"',
    },
    gl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Two-letter country code to boost geographically relevant results',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort expression, e.g. "date"',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Google API key',
    },
  },

  request: {
    url: (params: GoogleSearchParams) => {
      const baseUrl = 'https://www.googleapis.com/customsearch/v1'
      const searchParams = new URLSearchParams()

      // Add required parameters
      searchParams.append('key', params.apiKey)
      searchParams.append('q', params.query)
      searchParams.append('cx', params.searchEngineId)

      // Add optional parameters
      const num = Math.trunc(Number(params.num))
      if (Number.isFinite(num) && num > 0) {
        searchParams.append('num', Math.min(num, 10).toString())
      }
      const start = Math.trunc(Number(params.start))
      if (Number.isFinite(start) && start > 0) {
        searchParams.append('start', start.toString())
      }
      if (params.dateRestrict) {
        searchParams.append('dateRestrict', params.dateRestrict)
      }
      if (params.fileType) {
        searchParams.append('fileType', params.fileType)
      }
      if (params.safe) {
        searchParams.append('safe', params.safe)
      }
      if (params.searchType) {
        searchParams.append('searchType', params.searchType)
      }
      if (params.siteSearch) {
        searchParams.append('siteSearch', params.siteSearch)
        if (params.siteSearchFilter) {
          searchParams.append('siteSearchFilter', params.siteSearchFilter)
        }
      }
      if (params.lr) {
        searchParams.append('lr', params.lr)
      }
      if (params.gl) {
        searchParams.append('gl', params.gl)
      }
      if (params.sort) {
        searchParams.append('sort', params.sort)
      }

      return `${baseUrl}?${searchParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok || data.error) {
      throw new Error(`Google Search failed: ${data.error?.message || response.statusText}`)
    }

    return {
      success: true,
      output: {
        items: data.items || [],
        searchInformation: data.searchInformation || {
          totalResults: '0',
          searchTime: 0,
          formattedSearchTime: '0',
          formattedTotalResults: '0',
        },
        nextPageStartIndex: data.queries?.nextPage?.[0]?.startIndex ?? null,
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Array of search results from Google',
      items: {
        type: 'object',
        properties: GOOGLE_SEARCH_RESULT_OUTPUT_PROPERTIES,
      },
    },
    searchInformation: {
      type: 'object',
      description: 'Information about the search query and results',
      properties: GOOGLE_SEARCH_INFORMATION_OUTPUT_PROPERTIES,
    },
    nextPageStartIndex: {
      type: 'number',
      description: 'Start index for the next page of results (null if no further results)',
      optional: true,
    },
  },
}
