import type { ToolConfig } from '../types'
import type { ScrapeParams, ScrapeResponse } from './types'

export const scrapeTool: ToolConfig<ScrapeParams, ScrapeResponse> = {
  id: 'firecrawl_scrape',
  name: 'Firecrawl Website Scraper',
  description:
    'Extract structured content from web pages with comprehensive metadata support. Converts content to markdown or HTML while capturing SEO metadata, Open Graph tags, and page information.',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The URL to scrape content from',
    },
    scrapeOptions: {
      type: 'json',
      required: false,
      visibility: 'hidden',
      description: 'Options for content scraping',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Firecrawl API key',
    },
  },

  request: {
    method: 'POST',
    url: 'https://api.firecrawl.dev/v1/scrape',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => ({
      url: params.url,
      formats: params.scrapeOptions?.formats || ['markdown'],
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.error?.message || 'Unknown error occurred')
    }

    return {
      success: true,
      output: {
        markdown: data.data.markdown,
        html: data.data.html,
        metadata: data.data.metadata,
      },
    }
  },

  transformError: (error) => {
    const message = error.error?.message || error.message
    const code = error.error?.type || error.code
    return `${message} (${code})`
  },
}
