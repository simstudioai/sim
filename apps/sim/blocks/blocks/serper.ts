import { SerperIcon } from '@/components/icons'
import type { SearchResponse } from '@/tools/serper/types'
import type { BlockConfig } from '../types'

export const SerperBlock: BlockConfig<SearchResponse> = {
  type: 'serper',
  name: 'Serper',
  description: 'Search the web using Serper',
  longDescription:
    "Access real-time web search results with Serper's Google Search API integration. Retrieve structured search data including web pages, news, images, and places with customizable language and region settings.",
  docsLink: 'https://docs.simstudio.ai/tools/serper',
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
      options: [
        { label: 'search', id: 'search' },
        { label: 'news', id: 'news' },
        { label: 'places', id: 'places' },
        { label: 'images', id: 'images' },
      ],
    },
    {
      id: 'num',
      title: 'Number of Results',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: '10', id: '10' },
        { label: '20', id: '20' },
        { label: '30', id: '30' },
        { label: '40', id: '40' },
        { label: '50', id: '50' },
        { label: '100', id: '100' },
      ],
    },
    {
      id: 'gl',
      title: 'Country',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'US', id: 'US' },
        { label: 'GB', id: 'GB' },
        { label: 'CA', id: 'CA' },
        { label: 'AU', id: 'AU' },
        { label: 'DE', id: 'DE' },
        { label: 'FR', id: 'FR' },
      ],
    },
    {
      id: 'hl',
      title: 'Language',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'en', id: 'en' },
        { label: 'es', id: 'es' },
        { label: 'fr', id: 'fr' },
        { label: 'de', id: 'de' },
        { label: 'it', id: 'it' },
      ],
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
    searchResults: 'json',
  },
}
