import type { SearchParams, SearchResponse, SearchResult } from '@/tools/serper/types'
import { SERPER_SEARCH_RESULT_OUTPUT_PROPERTIES } from '@/tools/serper/types'
import type { ToolConfig } from '@/tools/types'

export const searchTool: ToolConfig<SearchParams, SearchResponse> = {
  id: 'serper_search',
  name: 'Web Search',
  description:
    'A powerful web search tool that provides access to Google search results through Serper.dev API. Supports different types of searches including regular web search, news, places, images, videos, and shopping. Returns comprehensive results including organic results, knowledge graph, answer box, people also ask, related searches, and top stories.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query (e.g., "latest AI news", "best restaurants in NYC")',
    },
    num: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (e.g., 10, 20, 50)',
    },
    gl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country code for search results (e.g., "us", "uk", "de", "fr")',
    },
    hl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Language code for search results (e.g., "en", "es", "de", "fr")',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Type of search to perform (e.g., "search", "news", "images", "videos", "places", "shopping")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Serper API Key',
    },
  },

  request: {
    url: (params) => `https://google.serper.dev/${params.type || 'search'}`,
    method: 'POST',
    headers: (params) => ({
      'X-API-KEY': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {
        q: params.query,
      }

      // Only include optional parameters if they are explicitly set
      if (params.num) body.num = Number(params.num)
      if (params.gl) body.gl = params.gl
      if (params.hl) body.hl = params.hl

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    const searchType = response.url.split('/').pop() || 'search'
    let searchResults: SearchResult[] = []

    if (searchType === 'news') {
      searchResults =
        data.news?.map((item: any, index: number) => ({
          title: item.title,
          link: item.link,
          snippet: item.snippet,
          position: index + 1,
          date: item.date,
          imageUrl: item.imageUrl,
        })) || []
    } else if (searchType === 'places') {
      searchResults =
        data.places?.map((item: any, index: number) => ({
          title: item.title,
          link: item.link,
          snippet: item.snippet,
          position: index + 1,
          rating: item.rating,
          reviews: item.reviews,
          address: item.address,
        })) || []
    } else if (searchType === 'images') {
      searchResults =
        data.images?.map((item: any, index: number) => ({
          title: item.title,
          link: item.link,
          snippet: item.snippet,
          position: index + 1,
          imageUrl: item.imageUrl,
        })) || []
    } else {
      searchResults =
        data.organic?.map((item: any, index: number) => ({
          title: item.title,
          link: item.link,
          snippet: item.snippet,
          position: index + 1,
        })) || []
    }

    return {
      success: true,
      output: {
        searchResults,
      },
    }
  },

  outputs: {
    searchResults: {
      type: 'array',
      description:
        'Search results with titles, links, snippets, and type-specific metadata (date for news, rating for places, imageUrl for images)',
      items: {
        type: 'object',
        properties: SERPER_SEARCH_RESULT_OUTPUT_PROPERTIES,
      },
    },
  },
}
