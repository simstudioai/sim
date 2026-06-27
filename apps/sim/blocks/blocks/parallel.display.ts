import { ParallelIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ParallelBlockDisplay = {
  type: 'parallel_ai',
  name: 'Parallel AI',
  description: 'Web research with Parallel AI',
  category: 'tools',
  bgColor: '#1D1C1A',
  icon: ParallelIcon,
  longDescription:
    'Integrate Parallel AI into the workflow. Can search the web, extract information from URLs, and conduct deep research.',
  docsLink: 'https://docs.sim.ai/integrations/parallel_ai',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay

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
