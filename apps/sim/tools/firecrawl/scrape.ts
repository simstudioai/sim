import type { ScrapeParams, ScrapeResponse } from '@/tools/firecrawl/types'
import type { ToolConfig } from '@/tools/types'

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
    url: 'https://api.firecrawl.dev/v2/scrape',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        url: params.url,
        formats: params.formats || params.scrapeOptions?.formats || ['markdown'],
      }

      // Add all optional top-level parameters if provided
      if (params.onlyMainContent !== undefined) body.onlyMainContent = params.onlyMainContent
      if (params.includeTags !== undefined) body.includeTags = params.includeTags
      if (params.excludeTags !== undefined) body.excludeTags = params.excludeTags
      if (params.maxAge !== undefined) body.maxAge = Number(params.maxAge)
      if (params.headers !== undefined) body.headers = params.headers
      if (params.waitFor !== undefined) body.waitFor = Number(params.waitFor)
      if (params.mobile !== undefined) body.mobile = params.mobile
      if (params.skipTlsVerification !== undefined)
        body.skipTlsVerification = params.skipTlsVerification
      if (params.timeout !== undefined) body.timeout = Number(params.timeout)
      if (params.parsers !== undefined) body.parsers = params.parsers
      if (params.actions !== undefined) body.actions = params.actions
      if (params.location !== undefined) body.location = params.location
      if (params.removeBase64Images !== undefined)
        body.removeBase64Images = params.removeBase64Images
      if (params.blockAds !== undefined) body.blockAds = params.blockAds
      if (params.proxy !== undefined) body.proxy = params.proxy
      if (params.storeInCache !== undefined) body.storeInCache = params.storeInCache
      if (params.zeroDataRetention !== undefined) body.zeroDataRetention = params.zeroDataRetention

      // Support legacy scrapeOptions for backwards compatibility
      if (params.scrapeOptions) {
        Object.assign(body, params.scrapeOptions)
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        markdown: data.data.markdown,
        html: data.data.html,
        metadata: data.data.metadata,
      },
    }
  },

  outputs: {
    markdown: { type: 'string', description: 'Page content in markdown format' },
    html: { type: 'string', description: 'Raw HTML content of the page' },
    metadata: {
      type: 'object',
      description: 'Page metadata including SEO and Open Graph information',
    },
  },
}
