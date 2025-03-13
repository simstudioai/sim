import { ToolConfig, ToolResponse } from '../types'

interface SearchParams {
  query: string
  apiKey: string
  num?: number
  gl?: string // country code
  hl?: string // language code
  type?: 'search' | 'news' | 'places' | 'images'
}

export interface SearchResult {
  title: string
  link: string
  snippet: string
  position: number
  imageUrl?: string
  date?: string
  rating?: string
  reviews?: string
  address?: string
}

export interface SearchResponse extends ToolResponse {
  output: {
    searchResults: SearchResult[]
  }
}

export const searchTool: ToolConfig<SearchParams, SearchResponse> = {
  id: 'serper_search',
  name: 'Web Search',
  description:
    'A powerful web search tool that provides access to Google search results through Serper.dev API. Supports different types of searches including regular web search, news, places, and images, with each result containing relevant metadata like titles, URLs, snippets, and type-specific information.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      description: 'The search query',
    },
    apiKey: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'Serper API Key',
    },
    num: {
      type: 'number',
      required: false,
      description: 'Number of results to return',
    },
    gl: {
      type: 'string',
      required: false,
      description: 'Country code for search results',
    },
    hl: {
      type: 'string',
      required: false,
      description: 'Language code for search results',
    },
    type: {
      type: 'string',
      required: false,
      description: 'Type of search to perform',
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
      if (params.num) body.num = params.num
      if (params.gl) body.gl = params.gl
      if (params.hl) body.hl = params.hl

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || 'Failed to perform search')
    }

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

  transformError: (error) => {
    return error instanceof Error ? error.message : 'An error occurred while performing the search'
  },
}
