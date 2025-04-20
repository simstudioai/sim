import { ToolConfig, ToolResponse } from '../types'

export interface ScrapeParams {
  apiKey: string
  url: string
  scrapeOptions?: {
    onlyMainContent?: boolean
    formats?: string[]
  }
}

export interface ScrapeResponse extends ToolResponse {
  output: {
    markdown: string
    html?: string
    metadata: {
      title: string
      description: string
      language: string
      keywords: string
      robots: string
      ogTitle: string
      ogDescription: string
      ogUrl: string
      ogImage: string
      ogLocaleAlternate: string[]
      ogSiteName: string
      sourceURL: string
      statusCode: number
    }
  }
}

export const scrapeTool: ToolConfig<ScrapeParams, ScrapeResponse> = {
  id: 'firecrawl_scrape',
  name: 'Firecrawl Website Scraper',
  description:
    'Extract structured content from web pages with comprehensive metadata support. Converts content to markdown or HTML while capturing SEO metadata, Open Graph tags, and page information.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'Firecrawl API key',
    },
    url: {
      type: 'string',
      required: true,
      optionalToolInput: true,
      description: 'The URL to scrape content from',
    },
    scrapeOptions: {
      type: 'json',
      required: false,
      description: 'Options for content scraping',
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
