import { LinkupIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { LinkupSearchToolResponse } from '@/tools/linkup/types'

export const LinkupBlock: BlockConfig<LinkupSearchToolResponse> = {
  type: 'linkup',
  name: 'Linkup',
  description: 'Search the web with Linkup',
  authMode: AuthMode.ApiKey,
  longDescription: 'Integrate Linkup into the workflow. Can search the web.',
  docsLink: 'https://docs.sim.ai/tools/linkup',
  category: 'tools',
  integrationType: IntegrationType.Search,
  bgColor: '#D6D3C7',
  icon: LinkupIcon,

  subBlocks: [
    {
      id: 'q',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'Enter your search query',
      required: true,
    },
    {
      id: 'outputType',
      title: 'Output Type',
      type: 'dropdown',
      options: [
        { label: 'Answer', id: 'sourcedAnswer' },
        { label: 'Search', id: 'searchResults' },
      ],
      value: () => 'sourcedAnswer',
    },
    {
      id: 'depth',
      title: 'Search Depth',
      type: 'dropdown',
      options: [
        { label: 'Standard', id: 'standard' },
        { label: 'Deep', id: 'deep' },
      ],
      value: () => 'standard',
    },
    {
      id: 'includeImages',
      title: 'Include Images',
      type: 'switch',
      mode: 'advanced',
    },
    {
      id: 'includeInlineCitations',
      title: 'Include Inline Citations',
      type: 'switch',
      mode: 'advanced',
    },
    {
      id: 'includeSources',
      title: 'Include Sources',
      type: 'switch',
      mode: 'advanced',
    },
    {
      id: 'fromDate',
      title: 'From Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a date in YYYY-MM-DD format based on the user's description.
Examples:
- "last week" -> Calculate 7 days ago
- "beginning of this month" -> First day of current month
- "last year" -> January 1 of last year
- "3 months ago" -> Calculate 3 months ago

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the from date (e.g., "last week", "beginning of this month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'toDate',
      title: 'To Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a date in YYYY-MM-DD format based on the user's description.
Examples:
- "today" -> Today's date
- "yesterday" -> Yesterday's date
- "end of last month" -> Last day of previous month
- "now" -> Today's date

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the to date (e.g., "today", "end of last month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'includeDomains',
      title: 'Include Domains',
      type: 'long-input',
      placeholder: 'example.com, another.com (comma-separated)',
      mode: 'advanced',
    },
    {
      id: 'excludeDomains',
      title: 'Exclude Domains',
      type: 'long-input',
      placeholder: 'example.com, another.com (comma-separated)',
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Linkup API key',
      password: true,
      required: true,
      hideWhenHosted: true,
    },
  ],

  tools: {
    access: ['linkup_search'],
  },

  inputs: {
    q: { type: 'string', description: 'Search query' },
    apiKey: { type: 'string', description: 'Linkup API key' },
    depth: { type: 'string', description: 'Search depth level' },
    outputType: { type: 'string', description: 'Output format type' },
    includeImages: { type: 'boolean', description: 'Include images in results' },
    includeInlineCitations: { type: 'boolean', description: 'Add inline citations to answers' },
    includeSources: { type: 'boolean', description: 'Include sources in response' },
    fromDate: { type: 'string', description: 'Start date for filtering (YYYY-MM-DD)' },
    toDate: { type: 'string', description: 'End date for filtering (YYYY-MM-DD)' },
    includeDomains: {
      type: 'string',
      description: 'Domains to restrict search to (comma-separated)',
    },
    excludeDomains: {
      type: 'string',
      description: 'Domains to exclude from search (comma-separated)',
    },
  },

  outputs: {
    answer: { type: 'string', description: 'Generated answer' },
    sources: { type: 'json', description: 'Source references' },
  },
}

export const LinkupBlockMeta = {
  tags: ['web-scraping', 'enrichment'],
  templates: [
    {
      icon: LinkupIcon,
      title: 'Linkup research agent',
      prompt:
        'Build a research agent that uses Linkup to find authoritative sources on a topic, returns answers with citations, and saves long-form research to a knowledge base.',
      modules: ['agent', 'knowledge-base', 'workflows'],
      category: 'productivity',
      tags: ['research'],
    },
    {
      icon: LinkupIcon,
      title: 'Linkup daily digest',
      prompt:
        'Create a scheduled daily workflow that runs Linkup searches on tracked topics, summarizes the top hits with citations, and emails the user a research digest.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: LinkupIcon,
      title: 'Linkup competitor monitor',
      prompt:
        'Build a scheduled workflow that runs Linkup searches for competitor mentions weekly, scores each by relevance, and writes a log to a tables-based competitive intel base.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
    },
    {
      icon: LinkupIcon,
      title: 'Linkup CRM account refresh',
      prompt:
        'Create a scheduled workflow that for accounts in the CRM runs Linkup research on each weekly, surfaces new signals, and writes the digest into the account record.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: LinkupIcon,
      title: 'Linkup + Slack research bot',
      prompt:
        'Build a Slack bot that answers research questions with Linkup-grounded citations, hands off to a human on low-confidence answers, and logs each conversation.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'communication'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: LinkupIcon,
      title: 'Linkup deep-research file',
      prompt:
        'Create a workflow that for a chosen topic runs Linkup deep research, captures the structured findings, and writes a full report file with citations.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research', 'content'],
    },
    {
      icon: LinkupIcon,
      title: 'Linkup pipeline-research feeder',
      prompt:
        'Build a workflow that takes a list of accounts in a research table, runs Linkup on each for the latest news, and writes findings back to the row.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
  ],
} as const satisfies BlockMeta
