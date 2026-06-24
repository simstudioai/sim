import { CrwIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { CrwResponse } from '@/tools/crw/types'

export const CrwBlock: BlockConfig<CrwResponse> = {
  type: 'crw',
  name: 'fastCRW',
  description: 'Scrape, search, crawl, and map web data',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate fastCRW into the workflow. Scrape pages, search the web, crawl entire sites, and map URL structures. fastCRW is a Firecrawl-compatible web scraper in a single binary — self-host or cloud.',
  docsLink: 'https://docs.sim.ai/integrations/crw',
  category: 'tools',
  integrationType: IntegrationType.Search,
  bgColor: '#181C1E',
  icon: CrwIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Scrape', id: 'scrape' },
        { label: 'Search', id: 'search' },
        { label: 'Crawl', id: 'crawl' },
        { label: 'Map', id: 'map' },
      ],
      value: () => 'scrape',
    },
    {
      id: 'url',
      title: 'Website URL',
      type: 'short-input',
      placeholder: 'Enter the website URL',
      condition: {
        field: 'operation',
        value: ['scrape', 'crawl', 'map'],
      },
      required: true,
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter the search query',
      condition: {
        field: 'operation',
        value: 'search',
      },
      required: true,
    },
    {
      id: 'onlyMainContent',
      title: 'Only Main Content',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['scrape', 'crawl'],
      },
    },
    {
      id: 'formats',
      title: 'Output Formats',
      type: 'long-input',
      placeholder: '["markdown", "html"]',
      condition: {
        field: 'operation',
        value: ['scrape', 'crawl'],
      },
    },
    {
      id: 'waitFor',
      title: 'Wait For (ms)',
      type: 'short-input',
      placeholder: '0',
      condition: {
        field: 'operation',
        value: 'scrape',
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: ['map', 'search'],
      },
    },
    {
      id: 'maxPages',
      title: 'Max Pages',
      type: 'short-input',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: 'crawl',
      },
    },
    {
      id: 'baseUrl',
      title: 'Base URL',
      type: 'short-input',
      placeholder: 'https://fastcrw.com/api',
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your fastCRW API key',
      password: true,
      required: true,
      hideWhenHosted: true,
    },
  ],
  tools: {
    access: ['crw_scrape', 'crw_search', 'crw_crawl', 'crw_map'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'scrape':
            return 'crw_scrape'
          case 'search':
            return 'crw_search'
          case 'crawl':
            return 'crw_crawl'
          case 'map':
            return 'crw_map'
          default:
            return 'crw_scrape'
        }
      },
      params: (params) => {
        const {
          operation,
          limit,
          maxPages,
          formats,
          waitFor,
          url,
          query,
          onlyMainContent,
          baseUrl,
          apiKey,
        } = params

        const result: Record<string, any> = { apiKey }

        if (baseUrl) result.baseUrl = baseUrl

        switch (operation) {
          case 'scrape':
            if (url) result.url = url
            if (formats) {
              if (Array.isArray(formats)) {
                result.formats = formats
              } else if (typeof formats === 'string') {
                try {
                  const parsed = JSON.parse(formats)
                  result.formats = Array.isArray(parsed) ? parsed : ['markdown']
                } catch {
                  result.formats = ['markdown']
                }
              }
            }
            if (waitFor) result.waitFor = Number.parseInt(waitFor)
            if (onlyMainContent != null) result.onlyMainContent = onlyMainContent
            break

          case 'search':
            if (query) result.query = query
            if (limit) result.limit = Number.parseInt(limit)
            break

          case 'crawl':
            if (url) result.url = url
            if (maxPages) result.maxPages = Number.parseInt(maxPages)
            if (formats) {
              if (Array.isArray(formats)) {
                result.formats = formats
              } else if (typeof formats === 'string') {
                try {
                  const parsed = JSON.parse(formats)
                  result.formats = Array.isArray(parsed) ? parsed : ['markdown']
                } catch {
                  result.formats = ['markdown']
                }
              }
            }
            if (onlyMainContent != null) result.onlyMainContent = onlyMainContent
            break

          case 'map':
            if (url) result.url = url
            if (limit) result.limit = Number.parseInt(limit)
            break
        }

        return result
      },
    },
  },
  inputs: {
    apiKey: { type: 'string', description: 'fastCRW API key' },
    baseUrl: { type: 'string', description: 'Base URL for self-hosted fastCRW' },
    operation: { type: 'string', description: 'Operation to perform' },
    url: { type: 'string', description: 'Target website URL' },
    query: { type: 'string', description: 'Search query terms' },
    limit: { type: 'string', description: 'Result/link limit' },
    maxPages: { type: 'string', description: 'Maximum pages to crawl' },
    formats: { type: 'json', description: 'Output formats array' },
    waitFor: { type: 'number', description: 'Wait time before scraping in ms' },
    onlyMainContent: { type: 'boolean', description: 'Extract only main content' },
    scrapeOptions: { type: 'json', description: 'Advanced scraping options' },
  },
  outputs: {
    // Scrape output
    markdown: { type: 'string', description: 'Page content markdown' },
    html: { type: 'string', description: 'Raw HTML content' },
    metadata: { type: 'json', description: 'Page metadata' },
    // Search output
    data: { type: 'json', description: 'Search results data' },
    // Crawl output
    pages: { type: 'json', description: 'Crawled pages data' },
    total: { type: 'number', description: 'Total pages found' },
    // Map output
    success: { type: 'boolean', description: 'Operation success status' },
    links: { type: 'json', description: 'Discovered URLs array' },
  },
}

export const CrwBlockMeta = {
  tags: ['web-scraping', 'automation'],
  templates: [
    {
      icon: CrwIcon,
      title: 'fastCRW competitor site monitor',
      prompt:
        'Build a scheduled workflow that uses fastCRW to scrape competitor pricing, product, and changelog pages weekly, diffs against the prior snapshot, and posts changes to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CrwIcon,
      title: 'fastCRW knowledge-base builder',
      prompt:
        'Build a workflow that crawls a documentation site with fastCRW, chunks and embeds the pages, and upserts them into a knowledge base for an answering agent.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['research', 'sync'],
    },
    {
      icon: CrwIcon,
      title: 'fastCRW research stack',
      prompt:
        'Create an agent that uses fastCRW Search to find authoritative URLs on a topic, scrapes each with fastCRW, and produces a structured research brief with citations.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research'],
    },
  ],
  skills: [
    {
      name: 'scrape-page-to-markdown',
      description:
        'Scrape a single URL with fastCRW and return clean main-content markdown for an agent to read.',
      content:
        '# Scrape Page to Markdown\n\nUse fastCRW to fetch a web page as clean, LLM-ready markdown.\n\n## Steps\n1. Use the Scrape operation on the target URL.\n2. Enable Only Main Content to strip navigation, ads, and footers; set a Wait For delay if the page renders content with JavaScript.\n3. Return the markdown output and capture page metadata (title, description).\n\n## Output\nReturn the page markdown plus key metadata. If the page failed to load or returned empty content, report that instead of fabricating text.',
    },
    {
      name: 'crawl-site',
      description:
        'Crawl an entire site or section with fastCRW and return the page content for indexing or analysis.',
      content:
        '# Crawl Site\n\nUse fastCRW to traverse a site and collect its pages.\n\n## Steps\n1. Use the Crawl operation on the root URL, setting a sensible Max Pages limit to control cost.\n2. Enable Only Main Content so each page comes back as clean markdown.\n3. Collect the crawled pages and their URLs from the response.\n\n## Output\nReturn the list of crawled pages with their URL and markdown content, plus the total page count. This output is ready to chunk and embed into a knowledge base.',
    },
    {
      name: 'research-with-search',
      description:
        'Run a web search with fastCRW, then scrape the top results into a cited research brief.',
      content:
        '# Research With Search\n\nUse fastCRW to gather and synthesize web sources on a topic.\n\n## Steps\n1. Use the Search operation with the research query and a result Limit.\n2. For the most relevant results, use Scrape to pull the full page markdown.\n3. Synthesize the findings into a brief, attributing each claim to its source URL.\n\n## Output\nReturn a structured research brief with key findings and a Sources list of the URLs used. Keep claims grounded in the scraped content.',
    },
  ],
} as const satisfies BlockMeta
