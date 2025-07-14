import type { ToolConfig } from '../types'
import type { ExaSearchParams, ExaSearchResponse } from './types'

export const searchTool: ToolConfig<ExaSearchParams, ExaSearchResponse> = {
  id: 'exa_search',
  name: 'Exa Search',
  description:
    'Search the web using Exa AI. Returns relevant search results with titles, URLs, and text snippets.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query to execute',
    },
    numResults: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of results to return (default: 10, max: 25)',
    },
    useAutoprompt: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to use autoprompt to improve the query (default: false)',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Search type: neural, keyword, auto or magic (default: auto)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Exa AI API Key',
    },
  },

  request: {
    url: 'https://api.exa.ai/search',
    method: 'POST',
    isInternalRoute: false,
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        query: params.query,
      }

      // Add optional parameters if provided
      if (params.numResults) body.numResults = params.numResults
      if (params.useAutoprompt !== undefined) body.useAutoprompt = params.useAutoprompt
      if (params.type) body.type = params.type

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to perform Exa search')
    }

    return {
      success: true,
      output: {
        results: data.results.map((result: any) => ({
          title: result.title || '',
          url: result.url,
          publishedDate: result.publishedDate,
          author: result.author,
          summary: result.summary,
          favicon: result.favicon,
          image: result.image,
          text: result.text,
          score: result.score,
        })),
      },
    }
  },

  transformError: (error) => {
    return error instanceof Error
      ? error.message
      : 'An error occurred while performing the Exa search'
  },
}
