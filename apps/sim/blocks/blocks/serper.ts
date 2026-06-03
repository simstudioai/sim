import { SerperIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { SearchResponse } from '@/tools/serper/types'

export const SerperBlock: BlockConfig<SearchResponse> = {
  type: 'serper',
  name: 'Serper',
  description: 'Search the web using Serper',
  authMode: AuthMode.ApiKey,
  longDescription: 'Integrate Serper into the workflow. Can search the web.',
  docsLink: 'https://docs.sim.ai/tools/serper',
  category: 'tools',
  integrationType: IntegrationType.Search,
  bgColor: '#2B3543',
  icon: SerperIcon,
  subBlocks: [
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter your search query...',
      required: true,
    },
    {
      id: 'type',
      title: 'Search Type',
      type: 'dropdown',
      options: [
        { label: 'search', id: 'search' },
        { label: 'news', id: 'news' },
        { label: 'places', id: 'places' },
        { label: 'images', id: 'images' },
      ],
      value: () => 'search',
    },
    {
      id: 'num',
      title: 'Number of Results',
      type: 'dropdown',
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
      placeholder: 'Enter your Serper API key',
      password: true,
      required: true,
      hideWhenHosted: true,
    },
  ],
  tools: {
    access: ['serper_search'],
  },
  inputs: {
    query: { type: 'string', description: 'Search query terms' },
    apiKey: { type: 'string', description: 'Serper API key' },
    num: { type: 'number', description: 'Number of results' },
    gl: { type: 'string', description: 'Country code' },
    hl: { type: 'string', description: 'Language code' },
    type: { type: 'string', description: 'Search type' },
  },
  outputs: {
    searchResults: { type: 'json', description: 'Search results data' },
  },
}

export const SerperBlockMeta = {
  tags: ['web-scraping', 'seo'],
  templates: [
    {
      icon: SerperIcon,
      title: 'Serper SERP digest',
      prompt:
        'Build a scheduled daily workflow that runs Serper searches for tracked keywords, writes the SERP positions of my domain into a tables-based SEO log, and pings on changes.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SerperIcon,
      title: 'Serper competitor SERP watcher',
      prompt:
        'Create a workflow that runs Serper searches for competitor keywords weekly, captures top SERP entries, and writes a competitive SEO digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SerperIcon,
      title: 'Serper news monitor',
      prompt:
        'Build a scheduled workflow that uses Serper news search for brand keywords, classifies each result, and posts notable mentions to a Slack PR channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SerperIcon,
      title: 'Serper local-pack tracker',
      prompt:
        'Create a workflow that uses Serper to track Google local-pack rankings for tracked queries by city, writes the results to a tables-based SEO log, and surfaces wins.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
    },
    {
      icon: SerperIcon,
      title: 'Serper research agent',
      prompt:
        'Build an agent that uses Serper as a primary web-search tool, returns answers with citations, and saves long-form research to a knowledge base.',
      modules: ['agent', 'knowledge-base', 'workflows'],
      category: 'productivity',
      tags: ['research'],
    },
    {
      icon: SerperIcon,
      title: 'Serper image-search collector',
      prompt:
        'Create a workflow that uses Serper image search for brand or product mentions, captures unique image URLs into a table, and flags potential trademark misuse.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
    },
    {
      icon: SerperIcon,
      title: 'Serper geo-SERP comparator',
      prompt:
        'Build a scheduled workflow that runs Serper across multiple regions for the same keywords, identifies geo-relevant ranking differences, and writes the analysis to a file.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
    },
  ],
} as const satisfies BlockMeta
