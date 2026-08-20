import { FirecrawlIcon } from '@/components/icons'
import type { ScrapeResponse, SearchResponse } from '@/tools/firecrawl/types'
import type { BlockConfig } from '../types'

type FirecrawlResponse = ScrapeResponse | SearchResponse

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
      ],
      value: () => 'scrape',
    },
    {
      id: 'url',
      title: 'Website URL',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter the webpage URL to scrape',
      condition: {
        field: 'operation',
        value: 'scrape',
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
    access: ['firecrawl_scrape', 'firecrawl_search'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'scrape':
            return 'firecrawl_scrape'
          case 'search':
            return 'firecrawl_search'
          default:
            return 'firecrawl_scrape'
        }
      },
    },
  },
  inputs: {
    apiKey: { type: 'string', required: true },
    operation: { type: 'string', required: true },
    url: { type: 'string', required: false },
    query: { type: 'string', required: false },
    scrapeOptions: { type: 'json', required: false },
  },
  outputs: {
    response: {
      type: {
        // Scrape output
        markdown: 'string',
        html: 'any',
        metadata: 'json',
        // Search output
        data: 'json',
        warning: 'any',
      },
    },
  },
}
