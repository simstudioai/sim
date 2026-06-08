import { DuckDuckGoIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import type { DuckDuckGoResponse } from '@/tools/duckduckgo/types'

export const DuckDuckGoBlock: BlockConfig<DuckDuckGoResponse> = {
  type: 'duckduckgo',
  name: 'DuckDuckGo',
  description: 'Search with DuckDuckGo',
  longDescription:
    'Search the web using DuckDuckGo Instant Answers API. Returns instant answers, abstracts, related topics, and more. Free to use without an API key.',
  docsLink: 'https://docs.sim.ai/tools/duckduckgo',
  category: 'tools',
  integrationType: IntegrationType.Search,
  bgColor: '#FFFFFF',
  icon: DuckDuckGoIcon,
  subBlocks: [
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'Enter your search query...',
      required: true,
    },
    {
      id: 'noHtml',
      title: 'Remove HTML',
      type: 'switch',
      defaultValue: true,
    },
    {
      id: 'skipDisambig',
      title: 'Skip Disambiguation',
      type: 'switch',
    },
  ],
  tools: {
    access: ['duckduckgo_search'],
    config: {
      tool: () => 'duckduckgo_search',
    },
  },
  inputs: {
    query: { type: 'string', description: 'Search query terms' },
    noHtml: { type: 'boolean', description: 'Remove HTML from text in results' },
    skipDisambig: { type: 'boolean', description: 'Skip disambiguation results' },
  },
  outputs: {
    heading: { type: 'string', description: 'The heading/title of the instant answer' },
    abstract: { type: 'string', description: 'A short abstract summary of the topic' },
    abstractText: { type: 'string', description: 'Plain text version of the abstract' },
    abstractSource: { type: 'string', description: 'The source of the abstract' },
    abstractURL: { type: 'string', description: 'URL to the source of the abstract' },
    image: { type: 'string', description: 'URL to an image related to the topic' },
    answer: { type: 'string', description: 'Direct answer if available' },
    answerType: { type: 'string', description: 'Type of the answer' },
    type: { type: 'string', description: 'Response type (A, D, C, N, E)' },
    relatedTopics: { type: 'json', description: 'Array of related topics' },
    results: { type: 'json', description: 'Array of external link results' },
  },
}

export const DuckDuckGoBlockMeta = {
  tags: ['web-scraping'],
  templates: [
    {
      icon: DuckDuckGoIcon,
      title: 'DuckDuckGo private research agent',
      prompt:
        'Build an agent that runs DuckDuckGo searches for queries that need privacy preservation, returns answers with citations, and saves the findings to a knowledge base.',
      modules: ['agent', 'knowledge-base', 'workflows'],
      category: 'productivity',
      tags: ['research'],
    },
    {
      icon: DuckDuckGoIcon,
      title: 'DuckDuckGo daily digest',
      prompt:
        'Create a scheduled daily workflow that queries DuckDuckGo for topics I follow, summarizes the top hits with citations, and posts a digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DuckDuckGoIcon,
      title: 'DuckDuckGo competitor watcher',
      prompt:
        'Build a scheduled workflow that runs DuckDuckGo searches for competitor mentions weekly, scores each by relevance, and writes a competitive log to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
    },
    {
      icon: DuckDuckGoIcon,
      title: 'DuckDuckGo agent fallback',
      prompt:
        'Create an agent that uses Perplexity for primary search and falls back to DuckDuckGo on rate-limit errors so research workflows remain reliable.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research'],
      alsoIntegrations: ['perplexity'],
    },
    {
      icon: DuckDuckGoIcon,
      title: 'DuckDuckGo legal-research helper',
      prompt:
        'Build a workflow that uses DuckDuckGo to find precedents and analyses for legal questions, summarizes with citations, and writes a research file for review.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['legal', 'research'],
    },
    {
      icon: DuckDuckGoIcon,
      title: 'DuckDuckGo open-web validator',
      prompt:
        'Create a workflow that validates claims in an agent draft by searching DuckDuckGo for supporting sources, flagging claims without strong citations.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'analysis'],
    },
    {
      icon: DuckDuckGoIcon,
      title: 'DuckDuckGo enrichment researcher',
      prompt:
        'Build a workflow that uses DuckDuckGo to research prospect or company context where standard enrichment is missing, and writes the findings back to the CRM record.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['hubspot'],
    },
  ],
} as const satisfies BlockMeta
