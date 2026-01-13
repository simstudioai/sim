import type { ScrapeMarkdownParams, ScrapeMarkdownResponse } from '@/tools/brightdata/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Bright Data tool for scraping a URL into markdown.
 */
export const scrapeMarkdownTool: ToolConfig<ScrapeMarkdownParams, ScrapeMarkdownResponse> = {
  id: 'brightdata_scrape_markdown',
  name: 'Bright Data Scrape as Markdown',
  description: 'Scrape any website and convert it to clean markdown format using Bright Data',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The URL to scrape',
    },
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Bright Data API token',
    },
    unlockerZone: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Bright Data unlocker zone name (default: mcp_unlocker)',
    },
  },

  request: {
    method: 'POST',
    url: '/api/tools/brightdata/scrape-markdown',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      url: params.url,
      apiToken: params.apiToken,
      unlockerZone: params.unlockerZone || 'mcp_unlocker',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Bright Data scrape failed')
    }

    return {
      success: true,
      output: data,
    }
  },

  outputs: {
    markdown: {
      type: 'string',
      description: 'The scraped content in markdown format',
    },
    url: {
      type: 'string',
      description: 'The URL that was scraped',
    },
    title: {
      type: 'string',
      description: 'The page title',
      optional: true,
    },
  },
}
