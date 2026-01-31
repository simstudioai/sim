import type { ScrapeParams, ScrapeResponse } from '@/tools/firecrawl/types'
import { PAGE_METADATA_OUTPUT_PROPERTIES } from '@/tools/firecrawl/types'
import { safeAssign } from '@/tools/safe-assign'
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
      description: 'The URL to scrape content from (e.g., "https://example.com/page")',
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

      if (typeof params.onlyMainContent === 'boolean') body.onlyMainContent = params.onlyMainContent
      if (params.includeTags) body.includeTags = params.includeTags
      if (params.excludeTags) body.excludeTags = params.excludeTags
      if (params.maxAge) body.maxAge = Number(params.maxAge)
      if (params.headers) body.headers = params.headers
      if (params.waitFor) body.waitFor = Number(params.waitFor)
      if (typeof params.mobile === 'boolean') body.mobile = params.mobile
      if (typeof params.skipTlsVerification === 'boolean')
        body.skipTlsVerification = params.skipTlsVerification
      if (params.timeout) body.timeout = Number(params.timeout)
      if (params.parsers) body.parsers = params.parsers
      if (params.actions) body.actions = params.actions
      if (params.location) body.location = params.location
      if (typeof params.removeBase64Images === 'boolean')
        body.removeBase64Images = params.removeBase64Images
      if (typeof params.blockAds === 'boolean') body.blockAds = params.blockAds
      if (params.proxy) body.proxy = params.proxy
      if (typeof params.storeInCache === 'boolean') body.storeInCache = params.storeInCache
      if (typeof params.zeroDataRetention === 'boolean')
        body.zeroDataRetention = params.zeroDataRetention

      if (params.scrapeOptions) {
        safeAssign(body, params.scrapeOptions as Record<string, unknown>)
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
    html: { type: 'string', description: 'Raw HTML content of the page', optional: true },
    metadata: {
      type: 'object',
      description: 'Page metadata including SEO and Open Graph information',
      properties: PAGE_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
