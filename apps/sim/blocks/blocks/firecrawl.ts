import { FirecrawlIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { FirecrawlResponse } from '@/tools/firecrawl/types'

export const FirecrawlBlock: BlockConfig<FirecrawlResponse> = {
  type: 'firecrawl',
  name: 'Firecrawl',
  description: 'Scrape or search the web',
  longDescription:
    'Extract content from any website with advanced web scraping or search the web for information. Retrieve clean, structured data from web pages with options to focus on main content, or intelligently search for information across the web.',
  docsLink: 'https://docs.simstudio.ai/tools/firecrawl',
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
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Firecrawl API key',
      password: true,
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
    apiKey: { type: 'string', required: true },
    operation: { type: 'string', required: true },
    url: { type: 'string', required: false },
    limit: { type: 'string', required: false },
    query: { type: 'string', required: false },
    scrapeOptions: { type: 'json', required: false },
  },
  outputs: {
    // Scrape output
    markdown: 'string',
    html: 'any',
    metadata: 'json',
    // Search output
    data: 'json',
    warning: 'any',
    // Crawl output
    pages: 'json',
    total: 'number',
    creditsUsed: 'number',
  },
}
