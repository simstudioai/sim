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
  docsLink: 'https://docs.sim.ai/integrations/airweave',
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
  url: 'https://airweave.ai',
  templates: [
    {
      icon: AirweaveIcon,
      title: 'Airweave cross-source answerer',
      prompt:
        'Build a workflow that takes a user question, searches across your Airweave-synced sources — Notion, Confluence, Drive — and returns an AI-generated answer with sourced citations.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'enterprise'],
    },
    {
      icon: AirweaveIcon,
      title: 'Airweave + agent answer endpoint',
      prompt:
        'Create an agent that searches an Airweave-managed retrieval layer, answers user questions with sourced citations, and deploys as a chat endpoint for internal teams.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'enterprise'],
    },
    {
      icon: AirweaveIcon,
      title: 'Airweave daily knowledge digest',
      prompt:
        'Build a scheduled workflow that runs a set of standing Airweave searches each morning, summarizes the freshest results per topic, and posts a digest to Slack for the team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AirweaveIcon,
      title: 'Airweave research-to-table',
      prompt:
        'Create a workflow that takes a list of research questions, runs an Airweave search for each, and writes the top answers with their citations into a table for review.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['research', 'automation'],
    },
    {
      icon: AirweaveIcon,
      title: 'Airweave answer-quality checker',
      prompt:
        'Build a scheduled workflow that runs a benchmark set of questions against Airweave, has an agent grade each answer for relevance and citation quality, and writes a quality report to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
    },
    {
      icon: AirweaveIcon,
      title: 'Airweave + Slack Q&A',
      prompt:
        'Create a Slack bot that searches an Airweave-managed retrieval layer to answer questions in support channels with sourced citations.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'community'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AirweaveIcon,
      title: 'Airweave weekly topic tracker',
      prompt:
        'Build a scheduled weekly workflow that searches Airweave for updates on tracked topics, summarizes what is new since last week, and writes a report for the team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['research', 'reporting'],
    },
  ],
  skills: [
    {
      name: 'answer-from-collection',
      description:
        'Search an Airweave collection across synced sources and answer a question with grounded, cited results.',
      content:
        '# Answer From Collection\n\nUse Airweave to retrieve current context across connected apps and answer a question.\n\n## Steps\n1. Take the user question and search the relevant Airweave collection.\n2. Review the top results, noting which source each came from (docs, tickets, CRM, etc.).\n3. Synthesize an answer grounded only in the retrieved content.\n4. If the collection returns nothing relevant, say so instead of guessing.\n\n## Output\nA concise answer with citations back to the source records. Do not include claims unsupported by the results.',
    },
    {
      name: 'build-context-brief',
      description:
        'Search an Airweave collection for a person, account, or project and compile a context brief from all sources.',
      content:
        '# Build Context Brief\n\nGather everything Airweave knows about a subject across synced sources into one brief.\n\n## Steps\n1. Search the collection for the subject (account name, project, customer, or person).\n2. Pull relevant hits from each source type and group them.\n3. Summarize the current state, recent activity, and any open items.\n\n## Output\nA short brief organized by source, highlighting the most recent and relevant facts plus open questions.',
    },
  ],
} as const satisfies BlockMeta
