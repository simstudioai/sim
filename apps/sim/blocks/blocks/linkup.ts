import { LinkupIcon } from '@/components/icons'
import { LinkupBlockDisplay } from '@/blocks/blocks/linkup.display'
import { AuthMode, type BlockConfig, type BlockMeta } from '@/blocks/types'
import type { LinkupSearchToolResponse } from '@/tools/linkup/types'

export const LinkupBlock: BlockConfig<LinkupSearchToolResponse> = {
  ...LinkupBlockDisplay,
  authMode: AuthMode.ApiKey,

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
  url: 'https://www.linkup.so',
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
  skills: [
    {
      name: 'answer-with-citations',
      description:
        'Answer a question with Linkup using a sourced answer and surface the supporting source URLs.',
      content:
        '# Answer with Citations\n\nGround an answer in live web facts using Linkup.\n\n## Steps\n1. Set the search query to the user question, phrased clearly.\n2. Choose the Answer output type and include sources so the response carries verifiable URLs.\n3. Use Deep search depth for complex or multi-part questions, otherwise Standard.\n4. Present the answer and attach the source links.\n\n## Output\nA concise answer followed by a list of the source URLs that support it.',
    },
    {
      name: 'gather-research-sources',
      description:
        'Run a Linkup search and return a ranked list of relevant sources with snippets for a topic.',
      content:
        '# Gather Research Sources\n\nCollect authoritative sources on a topic for downstream research.\n\n## Steps\n1. Set the search query to the research topic, narrowing with key terms.\n2. Choose the Search output type to get raw results with sources.\n3. Optionally restrict or exclude domains, and set a from and to date to bound recency.\n4. Review the returned sources and order them by relevance.\n\n## Output\nA ranked list of sources with titles, URLs, and snippets, ready to feed a summarizer or knowledge base.',
    },
    {
      name: 'monitor-topic-mentions',
      description:
        'Search Linkup for recent mentions of a topic, competitor, or brand within a date window.',
      content:
        '# Monitor Topic Mentions\n\nTrack fresh mentions of a topic or competitor.\n\n## Steps\n1. Set the search query to the brand, competitor, or topic to monitor.\n2. Use the Search output type and set the from date to the start of the window you want to cover.\n3. Optionally restrict to news or specific domains.\n4. Filter the results to genuinely new or relevant mentions and summarize each.\n\n## Output\nA list of new mentions with source URL, date, and a one-line summary of each.',
    },
  ],
} as const satisfies BlockMeta
