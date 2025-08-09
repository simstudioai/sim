import { FirecrawlIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { FirecrawlResponse } from '@/tools/firecrawl/types'

export const FirecrawlBlock: BlockConfig<FirecrawlResponse> = {
  type: 'firecrawl',
  name: 'Firecrawl',
  description: 'Scrape or search the web',
  longDescription:
    'Extract content from any website with advanced web scraping or search the web for information. Retrieve clean, structured data from web pages with options to focus on main content, or intelligently search for information across the web.',
  docsLink: 'https://docs.sim.ai/tools/firecrawl',
  category: 'tools',
  bgColor: '#181C1E',
  icon: FirecrawlIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Scrape', id: 'scrape' },
        { label: 'Search', id: 'search' },
        { label: 'Crawl', id: 'crawl' },
      ],
      value: () => 'scrape',
    },
    {
      id: 'url',
      title: 'Website URL',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter the website URL',
      condition: {
        field: 'operation',
        value: ['scrape', 'crawl'],
      },
      required: true,
    },
    {
      id: 'onlyMainContent',
      title: 'Only Main Content',
      type: 'switch',
      layout: 'half',
      condition: {
        field: 'operation',
        value: 'scrape',
      },
    },
    {
      id: 'limit',
      title: 'Page Limit',
      type: 'short-input',
      layout: 'half',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: 'crawl',
      },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter the search query',
      condition: {
        field: 'operation',
        value: 'search',
      },
      required: true,
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Firecrawl API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['firecrawl_scrape', 'firecrawl_search', 'firecrawl_crawl'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'scrape':
            return 'firecrawl_scrape'
          case 'search':
            return 'firecrawl_search'
          case 'crawl':
            return 'firecrawl_crawl'
          default:
            return 'firecrawl_scrape'
        }
      },
      params: (params) => {
        const { operation, limit, ...rest } = params

        switch (operation) {
          case 'crawl':
            return {
              ...rest,
              limit: limit ? Number.parseInt(limit) : undefined,
            }
          default:
            return rest
        }
      },
    },
  },
  inputs: {
    apiKey: { type: 'string', description: 'Firecrawl API key' },
    operation: { type: 'string', description: 'Operation to perform' },
    url: { type: 'string', description: 'Target website URL' },
    limit: { type: 'string', description: 'Page crawl limit' },
    query: { type: 'string', description: 'Search query terms' },
    scrapeOptions: { type: 'json', description: 'Scraping options' },
  },
  outputs: {
    // Scrape output
    markdown: { type: 'string', description: 'Page content markdown' },
    html: { type: 'string', description: 'Raw HTML content' },
    metadata: { type: 'json', description: 'Page metadata' },
    // Search output
    data: { type: 'json', description: 'Search results data' },
    warning: { type: 'string', description: 'Warning messages' },
    // Crawl output
    pages: { type: 'json', description: 'Crawled pages data' },
    total: { type: 'number', description: 'Total pages found' },
    creditsUsed: { type: 'number', description: 'Credits consumed' },
  },
}
