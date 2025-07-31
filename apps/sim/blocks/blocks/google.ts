import { GoogleIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { GoogleSearchResponse } from '@/tools/google/types'

export const GoogleSearchBlock: BlockConfig<GoogleSearchResponse> = {
  type: 'google_search',
  name: 'Google Search',
  description: 'Search the web',
  longDescription:
    'Searches the web using the Google Custom Search API, which provides high-quality search results from the entire internet or a specific site defined by a custom search engine ID.',
  docsLink: 'https://docs.sim.ai/tools/google_search',
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
      required: true,
    },
    {
      id: 'searchEngineId',
      title: 'Custom Search Engine ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Custom Search Engine ID',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Google API key',
      password: true,
      required: true,
    },
    {
      id: 'num',
      title: 'Number of Results',
      type: 'short-input',
      layout: 'half',
      placeholder: '10',
      required: true,
    },
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
    query: { type: 'string', description: 'Search query terms' },
    apiKey: { type: 'string', description: 'Google API key' },
    searchEngineId: { type: 'string', description: 'Custom search engine ID' },
    num: { type: 'string', description: 'Number of results' },
  },

  outputs: {
    items: { type: 'json', description: 'Search result items' },
    searchInformation: { type: 'json', description: 'Search metadata' },
  },
}
