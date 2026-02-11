import { AirweaveIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { AirweaveSearchResponse } from '@/tools/airweave/types'

export const AirweaveBlock: BlockConfig<AirweaveSearchResponse> = {
  type: 'airweave',
  name: 'Airweave',
  description: 'Search your synced data collections',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Search across your synced data sources using Airweave. Supports semantic search with hybrid, neural, or keyword retrieval strategies. Optionally generate AI-powered answers from search results.',
  docsLink: 'https://docs.airweave.ai',
  category: 'tools',
  bgColor: '#6366F1',
  icon: AirweaveIcon,
  subBlocks: [
    {
      id: 'collectionId',
      title: 'Collection ID',
      type: 'short-input',
      placeholder: 'Enter your collection readable ID...',
      required: true,
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'Enter your search query...',
      required: true,
    },
    {
      id: 'limit',
      title: 'Max Results',
      type: 'dropdown',
      options: [
        { label: '10', id: '10' },
        { label: '25', id: '25' },
        { label: '50', id: '50' },
        { label: '100', id: '100' },
      ],
      value: () => '25',
    },
    {
      id: 'retrievalStrategy',
      title: 'Retrieval Strategy',
      type: 'dropdown',
      options: [
        { label: 'Hybrid (Default)', id: 'hybrid' },
        { label: 'Neural', id: 'neural' },
        { label: 'Keyword', id: 'keyword' },
      ],
      value: () => 'hybrid',
    },
    {
      id: 'expandQuery',
      title: 'Expand Query',
      type: 'switch',
      description: 'Generate query variations to improve recall',
    },
    {
      id: 'rerank',
      title: 'Rerank Results',
      type: 'switch',
      description: 'Reorder results for improved relevance using LLM',
    },
    {
      id: 'generateAnswer',
      title: 'Generate Answer',
      type: 'switch',
      description: 'Generate a natural-language answer from results',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Airweave API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['airweave_search'],
  },
  inputs: {
    collectionId: { type: 'string', description: 'Airweave collection readable ID' },
    query: { type: 'string', description: 'Search query text' },
    apiKey: { type: 'string', description: 'Airweave API key' },
    limit: { type: 'number', description: 'Maximum number of results' },
    retrievalStrategy: {
      type: 'string',
      description: 'Retrieval strategy (hybrid/neural/keyword)',
    },
    expandQuery: { type: 'boolean', description: 'Generate query variations' },
    rerank: { type: 'boolean', description: 'Rerank results with LLM' },
    generateAnswer: { type: 'boolean', description: 'Generate AI answer' },
  },
  outputs: {
    results: { type: 'json', description: 'Search results with content and metadata' },
    completion: { type: 'string', description: 'AI-generated answer (when enabled)' },
  },
}
