import { AirweaveIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { AirweaveSearchResponse } from '@/tools/airweave/types'

export const AirweaveBlock: BlockConfig<AirweaveSearchResponse> = {
  type: 'airweave',
  name: 'Airweave',
  description: 'Search your synced data collections',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Search across your synced data sources using Airweave. Supports semantic search with hybrid, neural, or keyword retrieval strategies. Optionally generate AI-powered answers from search results.',
  docsLink: 'https://docs.sim.ai/tools/airweave',
  category: 'tools',
  integrationType: IntegrationType.Search,
  bgColor: '#6366F1',
  iconColor: '#6366F1',
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

export const AirweaveBlockMeta = {
  tags: ['vector-search', 'knowledge-base'],
  templates: [
    {
      icon: AirweaveIcon,
      title: 'Airweave knowledge connector',
      prompt:
        'Build a workflow that uses Airweave to keep a knowledge base in sync with multiple sources — Notion, Confluence, Drive — chunking and embedding new content as it changes.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['sync', 'enterprise'],
    },
    {
      icon: AirweaveIcon,
      title: 'Airweave + agent answer endpoint',
      prompt:
        'Create an agent that uses an Airweave-managed retrieval layer, answers user questions with sourced citations, and deploys as a chat endpoint for internal teams.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'enterprise'],
    },
    {
      icon: AirweaveIcon,
      title: 'Airweave connector audit',
      prompt:
        'Build a scheduled workflow that audits Airweave connector health, identifies stale sources, and posts a Slack report to the platform owner.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['monitoring', 'sync'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AirweaveIcon,
      title: 'Airweave reindex orchestrator',
      prompt:
        'Create a workflow that triggers an Airweave reindex when a critical source changes, monitors the job, and writes the run history to a control table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
    },
    {
      icon: AirweaveIcon,
      title: 'Airweave duplicate detector',
      prompt:
        'Build a workflow that scans Airweave-managed knowledge for near-duplicate chunks, writes merge candidates to a cleanup queue, and applies merges on approval.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
    },
    {
      icon: AirweaveIcon,
      title: 'Airweave + Slack Q&A',
      prompt:
        'Create a Slack bot that uses an Airweave-managed retrieval layer to answer questions in support channels with sourced citations and confidence scores.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'community'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AirweaveIcon,
      title: 'Airweave cost dashboard',
      prompt:
        'Build a scheduled weekly workflow that aggregates Airweave usage and embedding costs per tenant, calculates unit economics, and writes a finance-ready report.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
  ],
} as const satisfies BlockMeta
