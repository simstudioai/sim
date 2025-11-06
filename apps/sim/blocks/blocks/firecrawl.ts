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
    'Integrate Firecrawl into the workflow. Scrape pages, search the web, crawl entire sites, map URL structures, and extract structured data with AI.',
  docsLink: 'https://docs.sim.ai/tools/firecrawl',
  category: 'tools',
  bgColor: '#181C1E',
  icon: FirecrawlIcon,
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
        { label: 'Extract', id: 'extract' },
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
      id: 'urls',
      title: 'URLs',
      type: 'long-input',
      placeholder: '["https://example.com/page1", "https://example.com/page2"]',
      condition: {
        field: 'operation',
        value: 'extract',
      },
      required: true,
    },
    {
      id: 'prompt',
      title: 'Extraction Prompt',
      type: 'long-input',
      placeholder:
        'Describe what data to extract (e.g., "Extract product names, prices, and descriptions")',
      condition: {
        field: 'operation',
        value: 'extract',
      },
    },
    {
      id: 'onlyMainContent',
      title: 'Only Main Content',
      type: 'switch',
      condition: {
        field: 'operation',
        value: 'scrape',
      },
    },
    {
      id: 'formats',
      title: 'Output Formats',
      type: 'long-input',
      placeholder: '["markdown", "html"]',
      condition: {
        field: 'operation',
        value: 'scrape',
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
      id: 'mobile',
      title: 'Mobile Mode',
      type: 'switch',
      condition: {
        field: 'operation',
        value: 'scrape',
      },
    },
    {
      id: 'timeout',
      title: 'Timeout (ms)',
      type: 'short-input',
      placeholder: '60000',
      condition: {
        field: 'operation',
        value: ['scrape', 'search'],
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: ['crawl', 'map', 'search'],
      },
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
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
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
        const {
          operation,
          limit,
          urls,
          formats,
          timeout,
          waitFor,
          url,
          query,
          onlyMainContent,
          mobile,
          prompt,
          apiKey,
        } = params

        const result: Record<string, any> = { apiKey }

        // Handle operation-specific fields
        switch (operation) {
          case 'scrape':
            if (url) result.url = url
            if (formats) {
              try {
                result.formats = typeof formats === 'string' ? JSON.parse(formats) : formats
              } catch {
                result.formats = ['markdown']
              }
            }
            if (timeout) result.timeout = Number.parseInt(timeout)
            if (waitFor) result.waitFor = Number.parseInt(waitFor)
            if (onlyMainContent != null) result.onlyMainContent = onlyMainContent
            if (mobile != null) result.mobile = mobile
            break

          case 'search':
            if (query) result.query = query
            if (timeout) result.timeout = Number.parseInt(timeout)
            if (limit) result.limit = Number.parseInt(limit)
            break

          case 'crawl':
            if (url) result.url = url
            if (limit) result.limit = Number.parseInt(limit)
            if (onlyMainContent != null) result.onlyMainContent = onlyMainContent
            break

          case 'map':
            if (url) result.url = url
            if (limit) result.limit = Number.parseInt(limit)
            break

          case 'extract':
            if (urls) {
              try {
                result.urls = typeof urls === 'string' ? JSON.parse(urls) : urls
              } catch {
                result.urls = [urls]
              }
            }
            if (prompt) result.prompt = prompt
            break
        }

        return result
      },
    },
  },
  inputs: {
    apiKey: { type: 'string', description: 'Firecrawl API key' },
    operation: { type: 'string', description: 'Operation to perform' },
    url: { type: 'string', description: 'Target website URL' },
    urls: { type: 'json', description: 'Array of URLs for extraction' },
    query: { type: 'string', description: 'Search query terms' },
    prompt: { type: 'string', description: 'Extraction prompt' },
    limit: { type: 'string', description: 'Result/page limit' },
    formats: { type: 'json', description: 'Output formats array' },
    timeout: { type: 'number', description: 'Request timeout in ms' },
    waitFor: { type: 'number', description: 'Wait time before scraping in ms' },
    mobile: { type: 'boolean', description: 'Use mobile emulation' },
    onlyMainContent: { type: 'boolean', description: 'Extract only main content' },
    scrapeOptions: { type: 'json', description: 'Advanced scraping options' },
  },
  outputs: {
    // Scrape output
    markdown: { type: 'string', description: 'Page content markdown' },
    html: { type: 'string', description: 'Raw HTML content' },
    metadata: { type: 'json', description: 'Page metadata' },
    // Search output
    data: { type: 'json', description: 'Search results or extracted data' },
    warning: { type: 'string', description: 'Warning messages' },
    // Crawl output
    pages: { type: 'json', description: 'Crawled pages data' },
    total: { type: 'number', description: 'Total pages found' },
    creditsUsed: { type: 'number', description: 'Credits consumed' },
    // Map output
    success: { type: 'boolean', description: 'Operation success status' },
    links: { type: 'json', description: 'Discovered URLs array' },
    // Extract output
    sources: { type: 'json', description: 'Data sources array' },
  },
}
