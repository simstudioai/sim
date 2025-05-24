import { FirecrawlIcon } from '@/components/icons'
import type { ScrapeResponse } from '@/tools/firecrawl/types'
import type { BlockConfig } from '../types'

export const FirecrawlBlock: BlockConfig<ScrapeResponse> = {
  type: 'firecrawl',
  name: 'Firecrawl',
  description: 'Scrape website content',
  longDescription:
    'Extract content from any website with advanced web scraping capabilities and content filtering. Retrieve clean, structured data from web pages with options to focus on main content.',
  docsLink: 'https://docs.simstudio.ai/tools/firecrawl',
  category: 'tools',
  bgColor: '#181C1E',
  icon: FirecrawlIcon,
  subBlocks: [
    {
      id: 'url',
      title: 'Website URL',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter the webpage URL to scrape',
    },
    {
      id: 'onlyMainContent',
      title: 'Only Main Content',
      type: 'switch',
      layout: 'half',
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
    access: ['firecrawl_scrape'],
  },
  inputs: {
    apiKey: { type: 'string', required: true },
    url: { type: 'string', required: true },
    scrapeOptions: { type: 'json', required: false },
  },
  outputs: {
    response: {
      type: {
        markdown: 'string',
        html: 'any',
        metadata: 'json',
      },
    },
  },
}
