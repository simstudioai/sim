import { BrightDataIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { BrightDataResponse } from '@/tools/brightdata/types'

export const BrightDataBlock: BlockConfig<BrightDataResponse> = {
  type: 'brightdata',
  name: 'Bright Data',
  description: 'Web scraping, search, and dataset access',
  authMode: AuthMode.ApiKey,
  longDescription:
    "Access Bright Data's web data collection tools including web scraping, search, and datasets.",
  docsLink: 'https://docs.sim.ai/tools/brightdata',
  category: 'tools',
  bgColor: '#3D7FFC',
  icon: BrightDataIcon,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      required: true,
      options: [
        { label: 'Scrape as Markdown', id: 'scrape_markdown' },
        { label: 'Search Engine', id: 'search_engine' },
        { label: 'Amazon Product Dataset', id: 'dataset_amazon_product' },
      ],
      value: () => 'scrape_markdown',
    },
    {
      id: 'url',
      title: 'URL',
      type: 'short-input',
      placeholder: 'https://example.com',
      condition: { field: 'operation', value: 'scrape_markdown' },
      required: true,
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter search query',
      condition: { field: 'operation', value: 'search_engine' },
      required: true,
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'search_engine' },
    },
    {
      id: 'url',
      title: 'Amazon Product URL',
      type: 'short-input',
      placeholder: 'https://www.amazon.com/dp/...',
      condition: { field: 'operation', value: 'dataset_amazon_product' },
      required: true,
    },
    {
      id: 'apiToken',
      title: 'API Token',
      type: 'short-input',
      placeholder: 'Your Bright Data API token',
      password: true,
      required: true,
    },
    {
      id: 'unlockerZone',
      title: 'Unlocker Zone',
      type: 'short-input',
      placeholder: 'mcp_unlocker',
      mode: 'advanced',
    },
  ],

  tools: {
    access: [
      'brightdata_scrape_markdown',
      'brightdata_search_engine',
      'brightdata_dataset_amazon_product',
    ],
    config: {
      tool: (params: Record<string, unknown>) => {
        switch (params.operation) {
          case 'scrape_markdown':
            return 'brightdata_scrape_markdown'
          case 'search_engine':
            return 'brightdata_search_engine'
          case 'dataset_amazon_product':
            return 'brightdata_dataset_amazon_product'
          default:
            throw new Error('Invalid operation selected')
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    url: { type: 'string', description: 'URL to scrape or dataset input' },
    query: { type: 'string', description: 'Search query' },
    maxResults: { type: 'number', description: 'Maximum search results' },
    apiToken: { type: 'string', description: 'Bright Data API token' },
    unlockerZone: { type: 'string', description: 'Unlocker zone name' },
  },

  outputs: {
    markdown: { type: 'string', description: 'Scraped markdown content' },
    results: { type: 'array', description: 'Search results' },
    data: { type: 'object', description: 'Dataset response' },
    url: { type: 'string', description: 'Current or scraped URL' },
    title: { type: 'string', description: 'Page title' },
    success: { type: 'boolean', description: 'Operation success status' },
    snapshot_at: { type: 'string', description: 'Dataset snapshot timestamp' },
  },
}
