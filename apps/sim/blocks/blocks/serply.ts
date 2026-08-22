import { Search } from '@sim/emcn/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { SearchResponse } from '@/tools/serply/search'

export const SerplyBlock: BlockConfig<SearchResponse> = {
  type: 'serply',
  name: 'Serply',
  description: 'Search the web using Serply',
  authMode: AuthMode.ApiKey,
  longDescription: 'Integrate Serply into the workflow. Can search the web.',
  docsLink: 'https://docs.sim.ai/integrations/serply',
  category: 'tools',
  integrationType: IntegrationType.Search,
  bgColor: '#4F46E5',
  icon: Search,
  canvasPresentation: {
    defaultTitle: 'Serply',
    sentences: {
      default: [
        { text: 'Search Google for', field: 'query', core: true },
        { text: ', returning up to', field: 'num', after: 'results' },
      ],
    },
  },
  subBlocks: [
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter your search query...',
      required: true,
    },
    {
      id: 'num',
      title: 'Number of Results',
      type: 'dropdown',
      options: [
        { label: '10', id: '10' },
        { label: '20', id: '20' },
        { label: '30', id: '30' },
        { label: '50', id: '50' },
      ],
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Serply API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['serply_search'],
  },
  inputs: {
    query: { type: 'string', description: 'Search query terms' },
    apiKey: { type: 'string', description: 'Serply API key' },
    num: { type: 'number', description: 'Number of results' },
  },
  outputs: {
    searchResults: { type: 'json', description: 'Search results data' },
  },
}

export const SerplyBlockMeta = {
  tags: ['web-scraping', 'seo'],
  url: 'https://serply.io',
} as const satisfies BlockMeta
