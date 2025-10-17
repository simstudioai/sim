import { AirweaveIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { AirweaveSearchResponse } from '@/tools/airweave/types'

export const AirweaveBlock: BlockConfig<AirweaveSearchResponse> = {
  type: 'airweave',
  name: 'Airweave',
  description: 'Search connected data sources',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Search across all your connected data sources using Airweave. Supports 50+ integrations including Stripe, GitHub, Notion, Slack, HubSpot, Zendesk, and more. Get raw search results or AI-generated summaries.',
  category: 'tools',
  docsLink: 'https://docs.sim.ai/tools/airweave',
  bgColor: '#8B5CF6',
  icon: AirweaveIcon,
  subBlocks: [
    {
      id: 'collectionId',
      title: 'Collection ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'my-collection-id',
      required: true,
      description: 'The readable ID of your Airweave collection',
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      layout: 'full',
      placeholder: 'What information are you looking for?',
      required: true,
      description: 'Natural language search query to find relevant information',
    },
    {
      id: 'responseType',
      title: 'Response Type',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Raw Results', id: 'raw' },
        { label: 'AI Summary', id: 'completion' },
      ],
      value: () => 'raw',
      description: 'Get raw search results or an AI-generated answer',
    },
    {
      id: 'limit',
      title: 'Max Results',
      type: 'short-input',
      layout: 'half',
      placeholder: '10',
      description: 'Maximum number of results to return (1-100)',
    },
    {
      id: 'recencyBias',
      title: 'Recency Bias',
      type: 'slider',
      layout: 'half',
      min: 0,
      max: 1,
      step: 0.1,
      defaultValue: 0,
      description: 'Prioritize recent results (0=relevance only, 1=recency only)',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Airweave API key',
      password: true,
      required: true,
      description: 'Get your API key from https://app.airweave.ai',
    },
  ],
  tools: {
    access: ['airweave_search'],
  },
  inputs: {
    collectionId: { type: 'string', description: 'Airweave collection ID' },
    query: { type: 'string', description: 'Search query' },
    limit: { type: 'number', description: 'Maximum number of results' },
    offset: { type: 'number', description: 'Pagination offset' },
    responseType: { type: 'string', description: 'Response format (raw or completion)' },
    recencyBias: { type: 'number', description: 'Recency weighting (0.0-1.0)' },
    apiKey: { type: 'string', description: 'Airweave API key' },
  },
  outputs: {
    status: { type: 'string', description: 'Search operation status' },
    results: { type: 'json', description: 'Array of search results with metadata' },
    completion: { type: 'string', description: 'AI-generated answer (when using completion mode)' },
  },
}

