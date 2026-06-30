import { ParallelIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { ToolResponse } from '@/tools/types'

export const ParallelBlock: BlockConfig<ToolResponse> = {
  type: 'parallel_ai',
  name: 'Parallel AI',
  description: 'Web research with Parallel AI',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Parallel AI into the workflow. Can search the web, extract information from URLs, and conduct deep research.',
  docsLink: 'https://docs.sim.ai/integrations/parallel_ai',
  category: 'tools',
  integrationType: IntegrationType.Search,
  bgColor: '#1D1C1A',
  icon: ParallelIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search', id: 'search' },
        { label: 'Extract from URLs', id: 'extract' },
        { label: 'Deep Research', id: 'deep_research' },
      ],
      value: () => 'search',
    },
    {
      id: 'objective',
      title: 'Search Objective',
      type: 'long-input',
      placeholder: "When was the United Nations established? Prefer UN's websites.",
      required: true,
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'search_queries',
      title: 'Search Queries',
      type: 'long-input',
      placeholder:
        'Enter search queries separated by commas (e.g., "Founding year UN", "Year of founding United Nations")',
      required: false,
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'urls',
      title: 'URLs',
      type: 'long-input',
      placeholder:
        'Enter URLs separated by commas (e.g., https://example.com, https://another.com)',
      required: true,
      condition: { field: 'operation', value: 'extract' },
    },
    {
      id: 'extract_objective',
      title: 'Extract Objective',
      type: 'long-input',
      placeholder: 'What information to extract from the URLs?',
      required: false,
      condition: { field: 'operation', value: 'extract' },
    },
    {
      id: 'excerpts',
      title: 'Include Excerpts',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'extract' },
    },
    {
      id: 'full_content',
      title: 'Include Full Content',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'extract' },
    },
    {
      id: 'research_input',
      title: 'Research Query',
      type: 'long-input',
      placeholder: 'Enter your research question (up to 15,000 characters)',
      required: true,
      condition: { field: 'operation', value: 'deep_research' },
    },
    {
      id: 'search_mode',
      title: 'Search Mode',
      type: 'dropdown',
      options: [
        { label: 'One-Shot', id: 'one-shot' },
        { label: 'Agentic', id: 'agentic' },
        { label: 'Fast', id: 'fast' },
      ],
      value: () => 'one-shot',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'search_include_domains',
      title: 'Include Domains',
      type: 'short-input',
      placeholder: 'Comma-separated domains to include (e.g., .edu, example.com)',
      required: false,
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'search_exclude_domains',
      title: 'Exclude Domains',
      type: 'short-input',
      placeholder: 'Comma-separated domains to exclude',
      required: false,
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'include_domains',
      title: 'Include Domains',
      type: 'short-input',
      placeholder: 'Comma-separated domains to include',
      required: false,
      condition: { field: 'operation', value: 'deep_research' },
      mode: 'advanced',
    },
    {
      id: 'exclude_domains',
      title: 'Exclude Domains',
      type: 'short-input',
      placeholder: 'Comma-separated domains to exclude',
      required: false,
      condition: { field: 'operation', value: 'deep_research' },
      mode: 'advanced',
    },
    {
      id: 'processor',
      title: 'Research Processor',
      type: 'dropdown',
      options: [
        { label: 'Pro', id: 'pro' },
        { label: 'Ultra', id: 'ultra' },
        { label: 'Pro Fast', id: 'pro-fast' },
        { label: 'Ultra Fast', id: 'ultra-fast' },
      ],
      value: () => 'pro',
      condition: { field: 'operation', value: 'deep_research' },
      mode: 'advanced',
    },
    {
      id: 'max_results',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'max_chars_per_result',
      title: 'Max Chars Per Result',
      type: 'short-input',
      placeholder: '1500',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Parallel AI API key',
      password: true,
      required: true,
      hideWhenHosted: true,
    },
  ],
  tools: {
    access: ['parallel_search', 'parallel_extract', 'parallel_deep_research'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'search':
            return 'parallel_search'
          case 'extract':
            return 'parallel_extract'
          case 'deep_research':
            return 'parallel_deep_research'
          default:
            return 'parallel_search'
        }
      },
      params: (params) => {
        const result: Record<string, unknown> = {}
        const operation = params.operation

        if (operation === 'search') {
          if (params.search_queries && typeof params.search_queries === 'string') {
            const queries = params.search_queries
              .split(',')
              .map((query: string) => query.trim())
              .filter((query: string) => query.length > 0)
            if (queries.length > 0) {
              result.search_queries = queries
            }
          }
          if (params.search_mode && params.search_mode !== 'one-shot') {
            result.mode = params.search_mode
          }
          if (params.max_results) result.max_results = Number(params.max_results)
          if (params.max_chars_per_result) {
            result.max_chars_per_result = Number(params.max_chars_per_result)
          }
          result.include_domains = params.search_include_domains || undefined
          result.exclude_domains = params.search_exclude_domains || undefined
        }

        if (operation === 'extract') {
          if (params.extract_objective) result.objective = params.extract_objective
          result.excerpts = !(params.excerpts === 'false' || params.excerpts === false)
          result.full_content = params.full_content === 'true' || params.full_content === true
        }

        if (operation === 'deep_research') {
          if (params.research_input) result.input = params.research_input
          if (params.processor) result.processor = params.processor
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation type' },
    objective: { type: 'string', description: 'Search objective or question' },
    search_queries: { type: 'string', description: 'Comma-separated search queries' },
    urls: { type: 'string', description: 'Comma-separated URLs' },
    extract_objective: { type: 'string', description: 'What to extract from URLs' },
    excerpts: { type: 'boolean', description: 'Include excerpts' },
    full_content: { type: 'boolean', description: 'Include full content' },
    research_input: { type: 'string', description: 'Deep research query' },
    include_domains: { type: 'string', description: 'Domains to include (deep research)' },
    exclude_domains: { type: 'string', description: 'Domains to exclude (deep research)' },
    search_include_domains: { type: 'string', description: 'Domains to include (search)' },
    search_exclude_domains: { type: 'string', description: 'Domains to exclude (search)' },
    search_mode: { type: 'string', description: 'Search mode (one-shot, agentic, fast)' },
    processor: { type: 'string', description: 'Research processing tier' },
    max_results: { type: 'number', description: 'Maximum number of results' },
    max_chars_per_result: { type: 'number', description: 'Maximum characters per result' },
    apiKey: { type: 'string', description: 'Parallel AI API key' },
  },
  outputs: {
    results: {
      type: 'json',
      description: 'Search or extract results (array of url, title, excerpts)',
    },
    search_id: { type: 'string', description: 'Search request ID (for search)' },
    extract_id: { type: 'string', description: 'Extract request ID (for extract)' },
    status: { type: 'string', description: 'Task status (for deep research)' },
    run_id: { type: 'string', description: 'Task run ID (for deep research)' },
    message: { type: 'string', description: 'Status message (for deep research)' },
    content: {
      type: 'json',
      description: 'Research content (for deep research, structured based on output_schema)',
    },
    basis: {
      type: 'json',
      description:
        'Citations and sources with field, reasoning, citations, confidence (for deep research)',
    },
  },
}

export const ParallelBlockMeta = {
  tags: ['web-scraping', 'llm', 'agentic'],
  url: 'https://parallel.ai',
  templates: [
    {
      icon: ParallelIcon,
      title: 'Parallel AI account research agent',
      prompt:
        'Build a workflow that takes a company name, runs Parallel AI deep research for recent funding, leadership changes, and product launches, and writes a structured account brief with citations back to the matching CRM record.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: ParallelIcon,
      title: 'Parallel AI competitor monitor',
      prompt:
        'Create a scheduled workflow that uses Parallel AI search to find new announcements from a list of competitors, extracts the key details from each source URL, and posts a cited digest to Slack for the product team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['research', 'monitoring', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ParallelIcon,
      title: 'Parallel AI URL fact extractor',
      prompt:
        'Build a workflow that reads a table of source URLs, uses Parallel AI extract to pull the structured facts requested for each page, and writes the normalized results back to the table for review.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['research', 'automation', 'enrichment'],
    },
    {
      icon: ParallelIcon,
      title: 'Parallel AI market landscape report',
      prompt:
        'Create a workflow that runs Parallel AI deep research on a market category, synthesizes the players, pricing, and trends into a Markdown report file, and shares the link with the strategy team.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['research', 'analysis', 'reporting'],
    },
    {
      icon: ParallelIcon,
      title: 'Parallel AI lead enrichment pipeline',
      prompt:
        'Build a workflow that runs Parallel AI search and extract on each new inbound lead to find company size, industry, and tech stack, scores fit against the ICP, and updates the lead record with the enriched profile.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'enrichment', 'automation'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: ParallelIcon,
      title: 'Parallel AI due-diligence brief',
      prompt:
        'Create a workflow that runs Parallel AI deep research on a target company for litigation, leadership, and financial signals, extracts supporting detail from each cited source, and writes a due-diligence brief file for the deal team.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['research', 'enterprise', 'analysis'],
    },
    {
      icon: ParallelIcon,
      title: 'Parallel AI daily topic digest',
      prompt:
        'Build a scheduled daily workflow that uses Parallel AI search across the topics a team follows, extracts the key facts from the top results, and emails a concise cited digest each morning.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'reporting', 'automation'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'research-company-brief',
      description:
        'Run Parallel AI deep research on a company and produce a cited brief covering funding, leadership, and product.',
      content:
        '# Research Company Brief\n\nGenerate a sourced account brief for a target company.\n\n## Steps\n1. Use the Deep Research operation with a Research Query naming the company and the angles to cover: recent funding, leadership changes, product launches, and notable news.\n2. Choose a processor tier (Pro for balance, Ultra for depth) and optionally constrain Include or Exclude Domains.\n3. Read the structured content plus the basis field for citations and confidence per claim.\n\n## Output\nA brief organized by topic, where every claim links to its source URL from the basis, and note any low-confidence items that need verification.',
    },
    {
      name: 'web-search-with-objective',
      description:
        'Use Parallel AI search to answer a question across the web and return ranked, cited results.',
      content:
        '# Web Search With Objective\n\nAnswer a factual question grounded in fresh web sources.\n\n## Steps\n1. Use the Search operation and state a clear Objective describing what you want to know and which sources to prefer.\n2. Optionally add specific Search Queries, set a Search Mode (one-shot, agentic, or fast), and limit results with Include or Exclude Domains.\n3. Tune Max Results and Max Chars Per Result for breadth versus depth.\n\n## Output\nA direct answer to the objective followed by the supporting results, each with title, URL, and the relevant excerpt.',
    },
    {
      name: 'extract-facts-from-urls',
      description: 'Use Parallel AI extract to pull structured facts from a list of source URLs.',
      content:
        '# Extract Facts From URLs\n\nTurn a set of pages into structured data.\n\n## Steps\n1. Use the Extract operation and provide the comma-separated URLs to read.\n2. Set an Extract Objective describing exactly which fields to pull from each page.\n3. Enable Include Excerpts for supporting snippets and Include Full Content only when the whole page text is needed.\n\n## Output\nA normalized record per URL with the requested fields and an excerpt backing each value, plus a note on any URL that could not be parsed.',
    },
    {
      name: 'monitor-competitor-news',
      description:
        'Search Parallel AI for recent announcements from named competitors and summarize the changes.',
      content:
        '# Monitor Competitor News\n\nTrack what rivals shipped or announced recently.\n\n## Steps\n1. Use the Search operation with an Objective naming the competitors and the timeframe of interest.\n2. Optionally restrict Include Domains to the competitors official sites and reputable news outlets.\n3. For high-signal hits, follow up with the Extract operation to pull the specific details from each announcement URL.\n\n## Output\nA dated digest grouped by competitor, each item a one-line summary with its source URL and why it matters.',
    },
  ],
} as const satisfies BlockMeta
