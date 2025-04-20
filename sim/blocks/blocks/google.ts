import { GoogleIcon } from '@/components/icons'
import { BlockConfig } from '../types'
import { ToolResponse } from '@/tools/types'

interface GoogleSearchResponse extends ToolResponse {
  output: {
    items: Array<{
      title: string
      link: string
      snippet: string
      displayLink?: string
      pagemap?: Record<string, any>
    }>
    searchInformation: {
      totalResults: string
      searchTime: number
      formattedSearchTime: string
      formattedTotalResults: string
    }
  }
}

export const GoogleSearchBlock: BlockConfig<GoogleSearchResponse> = {
  type: 'google_search',
  name: 'Google Search',
  description: 'Search the web',
  longDescription: 'Searches the web using Google\'s Custom Search API, which provides high-quality search results from the entire internet or a specific site defined by a custom search engine ID.',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: GoogleIcon,

  subBlocks: [
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter your search query',
    },
    {
      id: 'searchEngineId',
      title: 'Custom Search Engine ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Custom Search Engine ID',
      description: 'Required Custom Search Engine ID',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Google API key',
      description: 'Required API Key for Google Search',
      password: true,
    },
    {
      id: 'num',
      title: 'Number of Results',
      type: 'short-input',
      layout: 'half',
      placeholder: '10',
      description: 'Number of search results to return (max: 10)',
    }
  ],

  tools: {
    access: ['google_search'],
    config: {
      tool: () => 'google_search',
      params: (params) => ({
        query: params.query,
        apiKey: params.apiKey,
        searchEngineId: params.searchEngineId,
        num: params.num || undefined,
      }),
    },
  },

  inputs: {
    query: {
      type: 'string',
      required: true,
      description: 'The search query to execute',
    },
    apiKey: {
      type: 'string',
      required: true,
      description: 'Google API key',
    },
    searchEngineId: {
      type: 'string',
      required: true,
      description: 'Custom Search Engine ID',
    },
    num: {
      type: 'string',
      required: false,
      description: 'Number of results to return (default: 10, max: 10)',
    }
  },

  outputs: {
    response: {
      type: {
        items: 'json',
        searchInformation: 'json',
      } as any,
    },
  },
} 