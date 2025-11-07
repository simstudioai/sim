import type { ToolConfig } from '@/tools/types'
import type { WikipediaSearchParams, WikipediaSearchResponse } from '@/tools/wikipedia/types'

export const searchTool: ToolConfig<WikipediaSearchParams, WikipediaSearchResponse> = {
  id: 'wikipedia_search',
  name: 'Wikipedia Search',
  description: 'Search for Wikipedia pages by title or content.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query to find Wikipedia pages',
    },
    searchLimit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of results to return (default: 10, max: 50)',
    },
  },

  request: {
    url: (params: WikipediaSearchParams) => {
      const baseUrl = 'https://en.wikipedia.org/w/api.php'
      const searchParams = new URLSearchParams()

      searchParams.append('action', 'opensearch')
      searchParams.append('search', params.query)
      searchParams.append('format', 'json')
      searchParams.append('namespace', '0')
      if (params.searchLimit) {
        searchParams.append('limit', Math.min(Number(params.searchLimit), 50).toString())
      } else {
        searchParams.append('limit', '10')
      }

      return `${baseUrl}?${searchParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'User-Agent': 'SimStudio/1.0 (https://sim.ai)',
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    const [searchTerm, titles, descriptions, urls] = data
    const searchResults = titles.map((title: string, index: number) => ({
      id: index,
      key: title.replace(/ /g, '_'),
      title: title,
      excerpt: descriptions[index] || '',
      matched_title: title,
      description: descriptions[index] || '',
      thumbnail: undefined, // OpenSearch doesn't provide thumbnails
      url: urls[index] || '',
    }))

    return {
      success: true,
      output: {
        searchResults,
        totalHits: titles.length,
        query: searchTerm,
      },
    }
  },

  outputs: {
    searchResults: {
      type: 'array',
      description: 'Array of matching Wikipedia pages',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          excerpt: { type: 'string' },
          url: { type: 'string' },
        },
      },
    },
    totalHits: {
      type: 'number',
      description: 'Total number of search results found',
    },
    query: {
      type: 'string',
      description: 'The search query that was executed',
    },
  },
}
