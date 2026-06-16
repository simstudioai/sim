import { ExaAIIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { ExaResponse } from '@/tools/exa/types'

export const ExaBlock: BlockConfig<ExaResponse> = {
  type: 'exa',
  name: 'Exa',
  description: 'Search with Exa AI',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Exa into the workflow. Can search, get contents, find similar links, answer a question, and perform research.',
  docsLink: 'https://docs.sim.ai/integrations/exa',
  category: 'tools',
  integrationType: IntegrationType.Search,
  bgColor: '#1F40ED',
  iconColor: '#1F40ED',
  icon: ExaAIIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search', id: 'exa_search' },
        { label: 'Get Contents', id: 'exa_get_contents' },
        { label: 'Find Similar Links', id: 'exa_find_similar_links' },
        { label: 'Answer', id: 'exa_answer' },
        { label: 'Research', id: 'exa_research' },
      ],
      value: () => 'exa_search',
    },
    // Search operation inputs
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'Enter your search query...',
      condition: { field: 'operation', value: 'exa_search' },
      required: true,
    },
    {
      id: 'numResults',
      title: 'Number of Results',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'exa_search' },
    },
    {
      id: 'useAutoprompt',
      title: 'Use Autoprompt',
      type: 'switch',
      condition: { field: 'operation', value: 'exa_search' },
      mode: 'advanced',
    },
    {
      id: 'type',
      title: 'Search Type',
      type: 'dropdown',
      options: [
        { label: 'Auto', id: 'auto' },
        { label: 'Neural', id: 'neural' },
        { label: 'Keyword', id: 'keyword' },
        { label: 'Fast', id: 'fast' },
      ],
      value: () => 'auto',
      condition: { field: 'operation', value: 'exa_search' },
      mode: 'advanced',
    },
    {
      id: 'includeDomains',
      title: 'Include Domains',
      type: 'long-input',
      placeholder: 'example.com, another.com (comma-separated)',
      condition: { field: 'operation', value: 'exa_search' },
      mode: 'advanced',
    },
    {
      id: 'excludeDomains',
      title: 'Exclude Domains',
      type: 'long-input',
      placeholder: 'exclude.com, another.com (comma-separated)',
      condition: { field: 'operation', value: 'exa_search' },
      mode: 'advanced',
    },
    {
      id: 'category',
      title: 'Category Filter',
      type: 'dropdown',
      options: [
        { label: 'None', id: '' },
        { label: 'Company', id: 'company' },
        { label: 'Research Paper', id: 'research_paper' },
        { label: 'News Article', id: 'news_article' },
        { label: 'PDF', id: 'pdf' },
        { label: 'GitHub', id: 'github' },
        { label: 'Tweet', id: 'tweet' },
        { label: 'Movie', id: 'movie' },
        { label: 'Song', id: 'song' },
        { label: 'Personal Site', id: 'personal_site' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'exa_search' },
      mode: 'advanced',
    },
    {
      id: 'text',
      title: 'Include Text',
      type: 'switch',
      condition: { field: 'operation', value: 'exa_search' },
    },
    {
      id: 'highlights',
      title: 'Include Highlights',
      type: 'switch',
      condition: { field: 'operation', value: 'exa_search' },
      mode: 'advanced',
    },
    {
      id: 'summary',
      title: 'Include Summary',
      type: 'switch',
      condition: { field: 'operation', value: 'exa_search' },
      mode: 'advanced',
    },
    {
      id: 'livecrawl',
      title: 'Live Crawl Mode',
      type: 'dropdown',
      options: [
        { label: 'Never (default)', id: 'never' },
        { label: 'Fallback', id: 'fallback' },
        { label: 'Always', id: 'always' },
      ],
      value: () => 'never',
      condition: { field: 'operation', value: 'exa_search' },
      mode: 'advanced',
    },
    {
      id: 'startPublishedDate',
      title: 'Start Published Date',
      type: 'short-input',
      placeholder: '2024-01-01 or 2024-01-01T00:00:00.000Z',
      condition: { field: 'operation', value: 'exa_search' },
      mode: 'advanced',
    },
    {
      id: 'endPublishedDate',
      title: 'End Published Date',
      type: 'short-input',
      placeholder: '2024-12-31 or 2024-12-31T23:59:59.999Z',
      condition: { field: 'operation', value: 'exa_search' },
      mode: 'advanced',
    },
    {
      id: 'startCrawlDate',
      title: 'Start Crawl Date',
      type: 'short-input',
      placeholder: '2024-01-01 or 2024-01-01T00:00:00.000Z',
      condition: { field: 'operation', value: 'exa_search' },
      mode: 'advanced',
    },
    {
      id: 'endCrawlDate',
      title: 'End Crawl Date',
      type: 'short-input',
      placeholder: '2024-12-31 or 2024-12-31T23:59:59.999Z',
      condition: { field: 'operation', value: 'exa_search' },
      mode: 'advanced',
    },
    // Get Contents operation inputs
    {
      id: 'urls',
      title: 'URLs',
      type: 'long-input',
      placeholder: 'Enter URLs to retrieve content from (comma-separated)...',
      condition: { field: 'operation', value: 'exa_get_contents' },
      required: true,
    },
    {
      id: 'text',
      title: 'Include Text',
      type: 'switch',
      condition: { field: 'operation', value: 'exa_get_contents' },
    },
    {
      id: 'summaryQuery',
      title: 'Summary Query',
      type: 'long-input',
      placeholder: 'Enter a query to guide the summary generation...',
      condition: { field: 'operation', value: 'exa_get_contents' },
      mode: 'advanced',
    },
    {
      id: 'subpages',
      title: 'Number of Subpages',
      type: 'short-input',
      placeholder: '5',
      condition: { field: 'operation', value: 'exa_get_contents' },
      mode: 'advanced',
    },
    {
      id: 'subpageTarget',
      title: 'Subpage Target Keywords',
      type: 'long-input',
      placeholder: 'docs, tutorial, about (comma-separated)',
      condition: { field: 'operation', value: 'exa_get_contents' },
      mode: 'advanced',
    },
    {
      id: 'highlights',
      title: 'Include Highlights',
      type: 'switch',
      condition: { field: 'operation', value: 'exa_get_contents' },
      mode: 'advanced',
    },
    // Find Similar Links operation inputs
    {
      id: 'url',
      title: 'URL',
      type: 'long-input',
      placeholder: 'Enter URL to find similar links for...',
      condition: { field: 'operation', value: 'exa_find_similar_links' },
      required: true,
    },
    {
      id: 'numResults',
      title: 'Number of Results',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'exa_find_similar_links' },
    },
    {
      id: 'text',
      title: 'Include Text',
      type: 'switch',
      condition: { field: 'operation', value: 'exa_find_similar_links' },
    },
    {
      id: 'includeDomains',
      title: 'Include Domains',
      type: 'long-input',
      placeholder: 'example.com, another.com (comma-separated)',
      condition: { field: 'operation', value: 'exa_find_similar_links' },
      mode: 'advanced',
    },
    {
      id: 'excludeDomains',
      title: 'Exclude Domains',
      type: 'long-input',
      placeholder: 'exclude.com, another.com (comma-separated)',
      condition: { field: 'operation', value: 'exa_find_similar_links' },
      mode: 'advanced',
    },
    {
      id: 'excludeSourceDomain',
      title: 'Exclude Source Domain',
      type: 'switch',
      condition: { field: 'operation', value: 'exa_find_similar_links' },
      mode: 'advanced',
    },
    {
      id: 'category',
      title: 'Category Filter',
      type: 'dropdown',
      options: [
        { label: 'None', id: '' },
        { label: 'Company', id: 'company' },
        { label: 'Research Paper', id: 'research_paper' },
        { label: 'News Article', id: 'news_article' },
        { label: 'PDF', id: 'pdf' },
        { label: 'GitHub', id: 'github' },
        { label: 'Tweet', id: 'tweet' },
        { label: 'Movie', id: 'movie' },
        { label: 'Song', id: 'song' },
        { label: 'Personal Site', id: 'personal_site' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'exa_find_similar_links' },
      mode: 'advanced',
    },
    {
      id: 'highlights',
      title: 'Include Highlights',
      type: 'switch',
      condition: { field: 'operation', value: 'exa_find_similar_links' },
      mode: 'advanced',
    },
    {
      id: 'summary',
      title: 'Include Summary',
      type: 'switch',
      condition: { field: 'operation', value: 'exa_find_similar_links' },
      mode: 'advanced',
    },
    {
      id: 'livecrawl',
      title: 'Live Crawl Mode',
      type: 'dropdown',
      options: [
        { label: 'Never (default)', id: 'never' },
        { label: 'Fallback', id: 'fallback' },
        { label: 'Always', id: 'always' },
      ],
      value: () => 'never',
      condition: { field: 'operation', value: 'exa_find_similar_links' },
      mode: 'advanced',
    },
    // Answer operation inputs
    {
      id: 'query',
      title: 'Question',
      type: 'long-input',
      placeholder: 'Enter your question...',
      condition: { field: 'operation', value: 'exa_answer' },
      required: true,
    },
    {
      id: 'text',
      title: 'Include Text',
      type: 'switch',
      condition: { field: 'operation', value: 'exa_answer' },
      mode: 'advanced',
    },
    // Research operation inputs
    {
      id: 'query',
      title: 'Research Query',
      type: 'long-input',
      placeholder: 'Enter your research topic or question...',
      condition: { field: 'operation', value: 'exa_research' },
      required: true,
    },
    {
      id: 'model',
      title: 'Research Model',
      type: 'dropdown',
      options: [
        { label: 'Standard (default)', id: 'exa-research' },
        { label: 'Fast', id: 'exa-research-fast' },
        { label: 'Pro', id: 'exa-research-pro' },
      ],
      value: () => 'exa-research',
      condition: { field: 'operation', value: 'exa_research' },
    },
    // API Key — hidden when hosted for operations with hosted key support
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Exa API key',
      password: true,
      required: true,
      hideWhenHosted: true,
      condition: { field: 'operation', value: 'exa_research', not: true },
    },
    // API Key — always visible for research (no hosted key support)
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Exa API key',
      password: true,
      required: true,
      condition: { field: 'operation', value: 'exa_research' },
    },
  ],
  tools: {
    access: [
      'exa_search',
      'exa_get_contents',
      'exa_find_similar_links',
      'exa_answer',
      'exa_research',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'exa_search':
            return 'exa_search'
          case 'exa_get_contents':
            return 'exa_get_contents'
          case 'exa_find_similar_links':
            return 'exa_find_similar_links'
          case 'exa_answer':
            return 'exa_answer'
          case 'exa_research':
            return 'exa_research'
          default:
            return 'exa_search'
        }
      },
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.numResults) {
          result.numResults = Number(params.numResults)
        }
        if (params.subpages) {
          result.subpages = Number(params.subpages)
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Exa API key' },
    // Search operation
    query: { type: 'string', description: 'Search query terms' },
    numResults: { type: 'number', description: 'Number of results' },
    useAutoprompt: { type: 'boolean', description: 'Use autoprompt feature' },
    type: { type: 'string', description: 'Search type' },
    includeDomains: { type: 'string', description: 'Include domains filter' },
    excludeDomains: { type: 'string', description: 'Exclude domains filter' },
    category: { type: 'string', description: 'Category filter' },
    text: { type: 'boolean', description: 'Include text content' },
    highlights: { type: 'boolean', description: 'Include highlights' },
    summary: { type: 'boolean', description: 'Include summary' },
    livecrawl: { type: 'string', description: 'Live crawl mode' },
    startCrawlDate: { type: 'string', description: 'Earliest crawl date (ISO 8601)' },
    endCrawlDate: { type: 'string', description: 'Latest crawl date (ISO 8601)' },
    startPublishedDate: { type: 'string', description: 'Earliest published date (ISO 8601)' },
    endPublishedDate: { type: 'string', description: 'Latest published date (ISO 8601)' },
    // Get Contents operation
    urls: { type: 'string', description: 'URLs to retrieve' },
    summaryQuery: { type: 'string', description: 'Summary query guidance' },
    subpages: { type: 'number', description: 'Number of subpages to crawl' },
    subpageTarget: { type: 'string', description: 'Subpage target keywords' },
    // Find Similar Links operation
    url: { type: 'string', description: 'Source URL' },
    excludeSourceDomain: { type: 'boolean', description: 'Exclude source domain' },
    // Research operation
    model: { type: 'string', description: 'Research model selection' },
  },
  outputs: {
    // Search output
    results: { type: 'json', description: 'Search results' },
    // Find Similar Links output
    similarLinks: { type: 'json', description: 'Similar links found' },
    // Answer output
    answer: { type: 'string', description: 'Generated answer' },
    citations: { type: 'json', description: 'Answer citations' },
    // Research output
    research: { type: 'json', description: 'Research findings' },
  },
}

export const ExaBlockMeta = {
  tags: ['web-scraping'],
  url: 'https://exa.ai',
  templates: [
    {
      icon: ExaAIIcon,
      title: 'Exa company intel agent',
      prompt:
        'Build an agent that takes a company name, uses Exa neural search to find recent product updates, funding news, and competitor mentions, and writes a one-page intel brief.',
      modules: ['agent', 'files', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: ExaAIIcon,
      title: 'Exa knowledge crawler',
      prompt:
        'Build a workflow that uses Exa to find authoritative URLs on a topic, scrapes each one, chunks the content, and upserts it into a knowledge base so the agent can answer with citations.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'sync'],
    },
    {
      icon: ExaAIIcon,
      title: 'Exa neural research agent',
      prompt:
        'Build an agent that uses Exa neural search to find authoritative sources on a topic, scrapes them, and produces a structured research brief with citations.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research'],
    },
    {
      icon: ExaAIIcon,
      title: 'Exa similar-page finder',
      prompt:
        'Create a workflow that takes a URL, runs Exa similar-page search to find related authoritative sources, and writes the discovery list to a research table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
    },
    {
      icon: ExaAIIcon,
      title: 'Exa daily research digest',
      prompt:
        'Build a scheduled workflow that runs Exa searches on tracked topics each morning, summarizes top hits with citations, and emails the user a research digest.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: ExaAIIcon,
      title: 'Exa investment research helper',
      prompt:
        'Create an agent that uses Exa to deep-research a ticker, finds recent material developments, summarizes with citations, and writes the brief to a finance research file.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['finance', 'research'],
    },
    {
      icon: ExaAIIcon,
      title: 'Exa competitor news monitor',
      prompt:
        'Build a scheduled daily workflow that runs Exa search for fresh news about my competitors, gets the page contents and finds similar coverage, summarizes the notable moves with citations, and posts a digest to the team Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'search-the-web-with-exa',
      description:
        'Run an Exa neural or keyword search to find high-quality web sources on a topic.',
      content:
        '# Search the Web with Exa\n\nFind authoritative web pages on a topic using Exa AI search.\n\n## Steps\n1. Use the Search operation with a clear query. Pick the search type — neural for meaning-based discovery, keyword for exact terms, or auto to let Exa decide.\n2. Narrow results with include/exclude domains, a category filter (research paper, news article, company, GitHub), and published-date bounds for recency.\n3. Enable include-text or include-summary so each result comes back with usable content rather than just a link.\n\n## Output\nReturn the top results with title, URL, published date, and the text or summary. Note which filters were applied so the search can be tightened or broadened.',
    },
    {
      name: 'answer-question-with-citations',
      description: 'Use Exa Answer to get a direct, sourced answer to a factual question.',
      content:
        '# Answer Question with Citations\n\nGet a grounded answer to a question with supporting sources via Exa.\n\n## Steps\n1. Use the Answer operation and pass the question in natural language.\n2. Enable include-text when you want the supporting passages, not just the citation URLs.\n3. Review the citations to confirm the answer is well-supported before relying on it.\n\n## Output\nReturn the answer text plus its citations (titles and URLs). If the citations are weak or conflicting, say so and recommend a follow-up search.',
    },
    {
      name: 'extract-page-contents',
      description: 'Use Exa Get Contents to pull clean text and summaries from a set of URLs.',
      content:
        '# Extract Page Contents\n\nRetrieve readable content from specific web pages using Exa.\n\n## Steps\n1. Use the Get Contents operation with the target URLs (comma-separated).\n2. Enable include-text for full content, and supply a summary query to get a focused summary tailored to what you need.\n3. To pull deeper context from a site, set a subpage count and target keywords (e.g., docs, pricing, about).\n\n## Output\nReturn each URL with its extracted text or summary and any highlights. Flag any URL that could not be crawled.',
    },
    {
      name: 'find-similar-pages',
      description: 'Use Exa Find Similar Links to discover pages related to a known URL.',
      content:
        '# Find Similar Pages\n\nDiscover sources similar to a reference page using Exa.\n\n## Steps\n1. Use the Find Similar Links operation with the source URL.\n2. Set the number of results and enable exclude-source-domain so you get genuinely new sources, not more pages from the same site.\n3. Apply a category filter or include/exclude domains to keep the discovery on-target, and enable include-text or include-summary for context.\n\n## Output\nReturn the similar pages with title, URL, and a snippet or summary, ordered by relevance. Note the filters used.',
    },
  ],
} as const satisfies BlockMeta
