import { FirecrawlIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { FirecrawlResponse } from '@/tools/firecrawl/types'

export const FirecrawlBlock: BlockConfig<FirecrawlResponse> = {
  type: 'firecrawl',
  name: 'Firecrawl',
  description: 'Scrape, search, crawl, map, and extract web data',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Firecrawl into the workflow. Can scrape pages, search the web, crawl entire websites, map URL structures, and extract structured data using AI.',
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
        { label: 'Map', id: 'map' },
        { label: 'Extract', id: 'extract' },
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
        value: ['scrape', 'crawl', 'map'],
      },
      required: true,
    },
    {
      id: 'urls',
      title: 'URLs',
      type: 'long-input',
      layout: 'full',
      placeholder:
        'Enter URLs as JSON array (e.g., ["https://example.com", "https://example.com/about"])',
      condition: {
        field: 'operation',
        value: 'extract',
      },
      required: true,
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
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Natural language instruction for extraction or crawling',
      condition: {
        field: 'operation',
        value: ['extract', 'crawl'],
      },
    },
    {
      id: 'schema',
      title: 'Schema',
      type: 'long-input',
      layout: 'full',
      placeholder: 'JSON Schema for data extraction',
      condition: {
        field: 'operation',
        value: 'extract',
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
      id: 'formats',
      title: 'Output Formats',
      type: 'long-input',
      layout: 'half',
      placeholder: '["markdown", "html"]',
      condition: {
        field: 'operation',
        value: 'scrape',
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      layout: 'half',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: ['crawl', 'search', 'map'],
      },
    },
    {
      id: 'timeout',
      title: 'Timeout (ms)',
      type: 'short-input',
      layout: 'half',
      placeholder: '60000',
      condition: {
        field: 'operation',
        value: ['scrape', 'search', 'map'],
      },
    },
    {
      id: 'mobile',
      title: 'Mobile Mode',
      type: 'switch',
      layout: 'half',
      condition: {
        field: 'operation',
        value: 'scrape',
      },
    },
    {
      id: 'blockAds',
      title: 'Block Ads',
      type: 'switch',
      layout: 'half',
      condition: {
        field: 'operation',
        value: 'scrape',
      },
    },
    {
      id: 'waitFor',
      title: 'Wait For (ms)',
      type: 'short-input',
      layout: 'half',
      placeholder: '0',
      condition: {
        field: 'operation',
        value: 'scrape',
      },
    },
    {
      id: 'excludePaths',
      title: 'Exclude Paths',
      type: 'long-input',
      layout: 'full',
      placeholder: '["^/admin", "^/private"]',
      condition: {
        field: 'operation',
        value: 'crawl',
      },
    },
    {
      id: 'includePaths',
      title: 'Include Paths',
      type: 'long-input',
      layout: 'full',
      placeholder: '["^/blog", "^/docs"]',
      condition: {
        field: 'operation',
        value: 'crawl',
      },
    },
    {
      id: 'allowSubdomains',
      title: 'Allow Subdomains',
      type: 'switch',
      layout: 'half',
      condition: {
        field: 'operation',
        value: 'crawl',
      },
    },
    {
      id: 'allowExternalLinks',
      title: 'Allow External Links',
      type: 'switch',
      layout: 'half',
      condition: {
        field: 'operation',
        value: 'crawl',
      },
    },
    {
      id: 'search',
      title: 'Search Filter',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Filter results by relevance (e.g., "blog")',
      condition: {
        field: 'operation',
        value: 'map',
      },
    },
    {
      id: 'includeSubdomains',
      title: 'Include Subdomains',
      type: 'switch',
      layout: 'half',
      condition: {
        field: 'operation',
        value: ['map', 'extract'],
      },
    },
    {
      id: 'showSources',
      title: 'Show Sources',
      type: 'switch',
      layout: 'half',
      condition: {
        field: 'operation',
        value: 'extract',
      },
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
    access: [
      'firecrawl_scrape',
      'firecrawl_search',
      'firecrawl_crawl',
      'firecrawl_map',
      'firecrawl_extract',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'scrape':
            return 'firecrawl_scrape'
          case 'search':
            return 'firecrawl_search'
          case 'crawl':
            return 'firecrawl_crawl'
          case 'map':
            return 'firecrawl_map'
          case 'extract':
            return 'firecrawl_extract'
          default:
            return 'firecrawl_scrape'
        }
      },
      params: (params) => {
        const { operation, limit, urls, formats, schema, ...rest } = params

        // Parse JSON fields if provided as strings
        const parsedParams: Record<string, any> = { ...rest }

        // Handle limit as number
        if (limit) {
          parsedParams.limit = Number.parseInt(limit)
        }

        // Handle JSON array fields
        if (urls && typeof urls === 'string') {
          try {
            parsedParams.urls = JSON.parse(urls)
          } catch {
            parsedParams.urls = [urls]
          }
        } else if (urls) {
          parsedParams.urls = urls
        }

        if (formats && typeof formats === 'string') {
          try {
            parsedParams.formats = JSON.parse(formats)
          } catch {
            parsedParams.formats = ['markdown']
          }
        } else if (formats) {
          parsedParams.formats = formats
        }

        if (schema && typeof schema === 'string') {
          try {
            parsedParams.schema = JSON.parse(schema)
          } catch {
            // Keep as string if not valid JSON
            parsedParams.schema = schema
          }
        } else if (schema) {
          parsedParams.schema = schema
        }

        return parsedParams
      },
    },
  },
  inputs: {
    apiKey: { type: 'string', description: 'Firecrawl API key' },
    operation: { type: 'string', description: 'Operation to perform' },
    url: { type: 'string', description: 'Target website URL' },
    urls: { type: 'json', description: 'Array of URLs for extraction' },
    query: { type: 'string', description: 'Search query terms' },
    prompt: { type: 'string', description: 'Natural language instruction' },
    schema: { type: 'json', description: 'JSON Schema for extraction' },
    limit: { type: 'string', description: 'Result/page limit' },
    formats: { type: 'json', description: 'Output formats array' },
    onlyMainContent: { type: 'boolean', description: 'Extract only main content' },
    timeout: { type: 'number', description: 'Request timeout in ms' },
    mobile: { type: 'boolean', description: 'Use mobile emulation' },
    blockAds: { type: 'boolean', description: 'Block ads and popups' },
    waitFor: { type: 'number', description: 'Wait time before scraping' },
    excludePaths: { type: 'json', description: 'Paths to exclude from crawl' },
    includePaths: { type: 'json', description: 'Paths to include in crawl' },
    allowSubdomains: { type: 'boolean', description: 'Allow subdomain crawling' },
    allowExternalLinks: { type: 'boolean', description: 'Allow external links' },
    search: { type: 'string', description: 'Search filter for map' },
    includeSubdomains: { type: 'boolean', description: 'Include subdomains' },
    showSources: { type: 'boolean', description: 'Show data sources' },
    scrapeOptions: { type: 'json', description: 'Advanced scraping options' },
  },
  outputs: {
    // Scrape outputs
    markdown: { type: 'string', description: 'Page content markdown' },
    html: { type: 'string', description: 'Raw HTML content' },
    metadata: { type: 'json', description: 'Page metadata' },
    // Search outputs
    data: { type: 'json', description: 'Search results or extracted data' },
    warning: { type: 'string', description: 'Warning messages' },
    // Crawl outputs
    pages: { type: 'json', description: 'Crawled pages data' },
    total: { type: 'number', description: 'Total pages found' },
    creditsUsed: { type: 'number', description: 'Credits consumed' },
    // Map outputs
    success: { type: 'boolean', description: 'Operation success status' },
    links: { type: 'json', description: 'Array of discovered URLs' },
    // Extract outputs
    sources: { type: 'json', description: 'Data sources array' },
  },
}
