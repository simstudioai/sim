import { SerperIcon } from '@/components/icons'
import { SearchResponse } from '@/tools/serper/search'
import { BlockConfig } from '../types'

export const SerperBlock: BlockConfig<SearchResponse> = {
  type: 'serper',
  name: 'Serper',
  description: 'Search the web using Serper',
  longDescription:
    "Access real-time web search results with Serper's Google Search API integration. Retrieve structured search data including web pages, news, images, and places with customizable language and region settings.",
  category: 'tools',
  bgColor: '#2B3543',
  icon: SerperIcon,
  subBlocks: [
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your search query...',
    },
    {
      id: 'type',
      title: 'Search Type',
      type: 'dropdown',
      layout: 'half',
      options: ['search', 'news', 'places', 'images'],
    },
    {
      id: 'num',
      title: 'Number of Results',
      type: 'dropdown',
      layout: 'half',
      options: ['10', '20', '30', '40', '50', '100'],
    },
    {
      id: 'gl',
      title: 'Country',
      type: 'dropdown',
      layout: 'half',
      options: ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'ES', 'IT', 'JP', 'KR'],
    },
    {
      id: 'hl',
      title: 'Language',
      type: 'dropdown',
      layout: 'half',
      options: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'],
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Serper API key',
      password: true,
    },
  ],
  tools: {
    access: ['serper_search'],
  },
  inputs: {
    query: { type: 'string', required: true },
    apiKey: { type: 'string', required: true },
    num: { type: 'number', required: false },
    gl: { type: 'string', required: false },
    hl: { type: 'string', required: false },
    type: { type: 'string', required: false },
  },
  outputs: {
    response: {
      type: {
        searchResults: 'json',
      },
    },
  },
}
