import type { ToolConfig } from '../types'
import type { GoogleSearchParams, GoogleSearchResponse } from './types'

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
      description: 'Number of results to return (default: 10, max: 10)',
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

      // Add optional parameter
      if (params.num) {
        searchParams.append('num', params.num.toString())
      }

      return `${baseUrl}?${searchParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error?.message || 'Failed to perform Google search')
    }

    const data = await response.json()

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
      },
    }
  },

  transformError: (error) => {
    return error instanceof Error
      ? error.message
      : 'An error occurred while performing the Google search'
  },
}
