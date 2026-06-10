import { YouIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { ToolResponse } from '@/tools/types'

export const YouBlock: BlockConfig<ToolResponse> = {
  type: 'you',
  name: 'You.com',
  description: 'Web search and research with You.com',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Search the web for real-time, LLM-ready results, extract clean content from any URL, and run web or finance research that returns grounded, well-cited answers.',
  docsLink: 'https://docs.sim.ai/integrations/you',
  category: 'tools',
  integrationType: IntegrationType.Search,
  bgColor: '#0B0B0F',
  icon: YouIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search', id: 'search' },
        { label: 'Get Contents', id: 'contents' },
        { label: 'Research', id: 'research' },
        { label: 'Finance Research', id: 'finance' },
      ],
      value: () => 'search',
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'What do you want to search for?',
      required: true,
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'urls',
      title: 'URLs',
      type: 'long-input',
      placeholder: 'Enter URLs separated by commas (e.g., https://example.com, https://other.com)',
      required: true,
      condition: { field: 'operation', value: 'contents' },
    },
    {
      id: 'research_input',
      title: 'Research Query',
      type: 'long-input',
      placeholder: 'Enter your research question (up to 40,000 characters)',
      required: true,
      condition: { field: 'operation', value: 'research' },
    },
    {
      id: 'finance_input',
      title: 'Finance Research Query',
      type: 'long-input',
      placeholder: 'e.g., What was Apple revenue in Q3 fiscal 2025?',
      required: true,
      condition: { field: 'operation', value: 'finance' },
    },
    {
      id: 'count',
      title: 'Number of Results',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'freshness',
      title: 'Freshness',
      type: 'short-input',
      placeholder: 'day, week, month, year, or YYYY-MM-DDtoYYYY-MM-DD',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'safesearch',
      title: 'Safe Search',
      type: 'dropdown',
      options: [
        { label: 'Default', id: 'none' },
        { label: 'Off', id: 'off' },
        { label: 'Moderate', id: 'moderate' },
        { label: 'Strict', id: 'strict' },
      ],
      value: () => 'none',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'country',
      title: 'Country',
      type: 'short-input',
      placeholder: 'Two-letter code (e.g., US, GB, JP)',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'language',
      title: 'Language',
      type: 'short-input',
      placeholder: 'BCP 47 code (e.g., EN, FR, DE)',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'livecrawl',
      title: 'Live Crawl',
      type: 'dropdown',
      options: [
        { label: 'Off', id: 'none' },
        { label: 'Web', id: 'web' },
        { label: 'News', id: 'news' },
        { label: 'All', id: 'all' },
      ],
      value: () => 'none',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'include_domains',
      title: 'Include Domains',
      type: 'short-input',
      placeholder: 'Comma-separated domains to include',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'exclude_domains',
      title: 'Exclude Domains',
      type: 'short-input',
      placeholder: 'Comma-separated domains to exclude',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'format',
      title: 'Content Format',
      type: 'dropdown',
      options: [
        { label: 'Markdown', id: 'markdown' },
        { label: 'HTML', id: 'html' },
        { label: 'Both', id: 'both' },
      ],
      value: () => 'markdown',
      condition: { field: 'operation', value: 'contents' },
      mode: 'advanced',
    },
    {
      id: 'crawl_timeout',
      title: 'Crawl Timeout (seconds)',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'contents' },
      mode: 'advanced',
    },
    {
      id: 'research_effort',
      title: 'Research Effort',
      type: 'dropdown',
      options: [
        { label: 'Lite', id: 'lite' },
        { label: 'Standard', id: 'standard' },
        { label: 'Deep', id: 'deep' },
        { label: 'Exhaustive', id: 'exhaustive' },
      ],
      value: () => 'standard',
      condition: { field: 'operation', value: 'research' },
      mode: 'advanced',
    },
    {
      id: 'finance_effort',
      title: 'Research Effort',
      type: 'dropdown',
      options: [
        { label: 'Deep', id: 'deep' },
        { label: 'Exhaustive', id: 'exhaustive' },
      ],
      value: () => 'deep',
      condition: { field: 'operation', value: 'finance' },
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your You.com API key',
      password: true,
      required: true,
      hideWhenHosted: true,
    },
  ],
  tools: {
    access: ['you_search', 'you_contents', 'you_research', 'you_finance'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'search':
            return 'you_search'
          case 'contents':
            return 'you_contents'
          case 'research':
            return 'you_research'
          case 'finance':
            return 'you_finance'
          default:
            return 'you_search'
        }
      },
      params: (params) => {
        const result: Record<string, unknown> = {}
        const operation = params.operation

        if (operation === 'search') {
          if (params.count) result.count = Number(params.count)
          if (params.offset) result.offset = Number(params.offset)
          if (params.freshness) result.freshness = params.freshness
          if (params.safesearch && params.safesearch !== 'none') {
            result.safesearch = params.safesearch
          }
          if (params.country) result.country = params.country
          if (params.language) result.language = params.language
          if (params.livecrawl && params.livecrawl !== 'none') {
            result.livecrawl = params.livecrawl
          }
          if (params.include_domains) result.include_domains = params.include_domains
          if (params.exclude_domains) result.exclude_domains = params.exclude_domains
        }

        if (operation === 'contents') {
          if (params.format) result.format = params.format
          if (params.crawl_timeout) result.crawl_timeout = Number(params.crawl_timeout)
        }

        if (operation === 'research') {
          if (params.research_input) result.input = params.research_input
          if (params.research_effort) result.research_effort = params.research_effort
        }

        if (operation === 'finance') {
          if (params.finance_input) result.input = params.finance_input
          if (params.finance_effort) result.research_effort = params.finance_effort
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation type' },
    query: { type: 'string', description: 'Search query' },
    urls: { type: 'string', description: 'Comma-separated URLs to extract content from' },
    research_input: { type: 'string', description: 'Research question' },
    finance_input: { type: 'string', description: 'Finance research question' },
    count: { type: 'number', description: 'Maximum number of results per section' },
    offset: { type: 'number', description: 'Pagination offset (0-9)' },
    freshness: { type: 'string', description: 'Freshness filter' },
    safesearch: { type: 'string', description: 'Safe search level' },
    country: { type: 'string', description: 'Country code' },
    language: { type: 'string', description: 'Language code' },
    livecrawl: { type: 'string', description: 'Live-crawl sections' },
    include_domains: { type: 'string', description: 'Domains to include (search)' },
    exclude_domains: { type: 'string', description: 'Domains to exclude (search)' },
    format: { type: 'string', description: 'Content output format' },
    crawl_timeout: { type: 'number', description: 'Crawl timeout in seconds' },
    research_effort: { type: 'string', description: 'Research effort level' },
    finance_effort: { type: 'string', description: 'Finance research effort level' },
    apiKey: { type: 'string', description: 'You.com API key' },
  },
  outputs: {
    web: { type: 'json', description: 'Web search results (for search)' },
    news: { type: 'json', description: 'News search results (for search)' },
    search_uuid: { type: 'string', description: 'Search request ID (for search)' },
    results: { type: 'json', description: 'Extracted page contents (for contents)' },
    content: {
      type: 'string',
      description: 'Synthesized research answer (for research and finance)',
    },
    content_type: { type: 'string', description: 'Type of the content field (for research)' },
    sources: {
      type: 'json',
      description: 'Cited sources with url, title, and snippets (for research and finance)',
    },
  },
}

export const YouBlockMeta = {
  tags: ['web-scraping', 'agentic', 'llm'],
  templates: [
    {
      icon: YouIcon,
      title: 'You.com research brief generator',
      prompt:
        'Build a workflow that takes a topic, runs You.com Research at deep effort, and writes a structured, fully cited brief to a file for the team to review.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['research', 'reporting', 'automation'],
    },
    {
      icon: YouIcon,
      title: 'You.com competitor news monitor',
      prompt:
        'Create a scheduled workflow that uses You.com Search with a freshness window to find recent announcements from a list of competitors and posts a cited digest to Slack each morning.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['research', 'monitoring', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: YouIcon,
      title: 'You.com URL content extractor',
      prompt:
        'Build a workflow that reads a table of source URLs, uses You.com Get Contents to pull clean Markdown for each page, and writes the extracted text back to the table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['web-scraping', 'automation', 'enrichment'],
    },
    {
      icon: YouIcon,
      title: 'You.com equity research assistant',
      prompt:
        'Create a workflow that takes a ticker or company name, runs You.com Finance Research at deep effort over SEC filings and earnings, and emails a cited summary of revenue, margins, and guidance.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['research', 'analysis', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: YouIcon,
      title: 'You.com lead enrichment pipeline',
      prompt:
        'Build a workflow that runs You.com Search on each new inbound lead to find company size, industry, and recent news, then updates the CRM record with the enriched profile and citations.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'enrichment', 'automation'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: YouIcon,
      title: 'You.com market landscape report',
      prompt:
        'Create a workflow that runs You.com Research on a market category, synthesizes the players, pricing, and trends into a Markdown report file, and shares the link with the strategy team.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['research', 'analysis', 'reporting'],
    },
    {
      icon: YouIcon,
      title: 'You.com daily topic digest',
      prompt:
        'Build a scheduled daily workflow that uses You.com Search across the topics a team follows, extracts the key facts from the top results, and emails a concise cited digest each morning.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'reporting', 'automation'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'web-search-with-youcom',
      description:
        'Use You.com Search to answer a question with fresh, cited web and news results.',
      content:
        '# Web Search With You.com\n\nAnswer a question grounded in current web sources.\n\n## Steps\n1. Use the Search operation and provide a clear Query. You.com supports operators like site:, filetype:, +term, -term, and AND/OR/NOT.\n2. Optionally narrow results with Freshness, Include or Exclude Domains, Country, and Language.\n3. Enable Live Crawl when you need full page content rather than snippets.\n\n## Output\nA direct answer followed by the supporting web and news results, each with title, URL, and the relevant snippet.',
    },
    {
      name: 'agentic-research-with-youcom',
      description:
        'Run You.com Research to produce a synthesized, well-cited answer to a complex question.',
      content:
        '# Agentic Research With You.com\n\nProduce a thorough, sourced answer to a hard question.\n\n## Steps\n1. Use the Research operation and state the full question in the Research Query.\n2. Pick a Research Effort: lite for speed, standard for balance, deep or exhaustive when accuracy matters most.\n3. Read the synthesized content and verify each claim against the cited sources.\n\n## Output\nA Markdown answer with inline citations plus the list of sources, each with URL, title, and supporting snippets.',
    },
  ],
} as const satisfies BlockMeta
