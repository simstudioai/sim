import { GoogleIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { GoogleSearchResponse } from '@/tools/google/types'

export const GoogleSearchBlock: BlockConfig<GoogleSearchResponse> = {
  type: 'google_search',
  name: 'Google Search',
  description: 'Search the web',
  authMode: AuthMode.ApiKey,
  longDescription: 'Integrate Google Search into the workflow. Can search the web.',
  docsLink: 'https://docs.sim.ai/tools/google_search',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: GoogleIcon,

  subBlocks: [
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'Enter your search query',
      required: true,
    },
    {
      id: 'searchEngineId',
      title: 'Custom Search Engine ID',
      type: 'short-input',
      placeholder: 'Enter your Custom Search Engine ID',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Google API key',
      password: true,
      required: true,
    },
    {
      id: 'num',
      title: 'Number of Results',
      type: 'short-input',
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
