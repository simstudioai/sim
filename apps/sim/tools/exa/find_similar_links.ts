import type { ToolConfig } from '../types'
import type { ExaFindSimilarLinksParams, ExaFindSimilarLinksResponse } from './types'

export const findSimilarLinksTool: ToolConfig<
  ExaFindSimilarLinksParams,
  ExaFindSimilarLinksResponse
> = {
  id: 'exa_find_similar_links',
  name: 'Exa Find Similar Links',
  description:
    'Find webpages similar to a given URL using Exa AI. Returns a list of similar links with titles and text snippets.',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The URL to find similar links for',
    },
    numResults: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of similar links to return (default: 10, max: 25)',
    },
    text: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include the full text of the similar pages',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Exa AI API Key',
    },
  },

  request: {
    url: 'https://api.exa.ai/findSimilar',
    method: 'POST',
    isInternalRoute: false,
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        url: params.url,
      }

      // Add optional parameters if provided
      if (params.numResults) body.numResults = params.numResults

      // Add contents.text parameter if text is true
      if (params.text) {
        body.contents = {
          text: true,
        }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to find similar links')
    }

    return {
      success: true,
      output: {
        similarLinks: data.results.map((result: any) => ({
          title: result.title || '',
          url: result.url,
          text: result.text || '',
          score: result.score || 0,
        })),
      },
    }
  },

  transformError: (error) => {
    return error instanceof Error ? error.message : 'An error occurred while finding similar links'
  },
}
