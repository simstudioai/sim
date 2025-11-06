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
    formats: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Output formats (markdown, html, rawHtml, links, images, screenshot). Default: ["markdown"]',
    },
    onlyMainContent: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Extract only main content, excluding headers, navs, footers (default: true)',
    },
    includeTags: {
      type: 'json',
      required: false,
      visibility: 'hidden',
      description: 'HTML tags to retain in the output',
    },
    excludeTags: {
      type: 'json',
      required: false,
      visibility: 'hidden',
      description: 'HTML tags to remove from the output',
    },
    maxAge: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Return cached version if younger than this age in ms (default: 172800000)',
    },
    headers: {
      type: 'json',
      required: false,
      visibility: 'hidden',
      description: 'Custom request headers (cookies, user-agent, etc.)',
    },
    waitFor: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Delay in milliseconds before fetching (default: 0)',
    },
    mobile: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Emulate mobile device (default: false)',
    },
    skipTlsVerification: {
      type: 'boolean',
      required: false,
      visibility: 'hidden',
      description: 'Skip TLS certificate verification (default: true)',
    },
    timeout: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Request timeout in milliseconds',
    },
    parsers: {
      type: 'json',
      required: false,
      visibility: 'hidden',
      description: 'File processing controls (e.g., ["pdf"])',
    },
    actions: {
      type: 'json',
      required: false,
      visibility: 'hidden',
      description: 'Pre-scrape operations (wait, click, scroll, screenshot, etc.)',
    },
    location: {
      type: 'json',
      required: false,
      visibility: 'hidden',
      description: 'Geographic settings (country, languages)',
    },
    removeBase64Images: {
      type: 'boolean',
      required: false,
      visibility: 'hidden',
      description: 'Strip base64 images from output (default: true)',
    },
    blockAds: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Enable ad and popup blocking (default: true)',
    },
    proxy: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Proxy type: basic, stealth, or auto (default: auto)',
    },
    storeInCache: {
      type: 'boolean',
      required: false,
      visibility: 'hidden',
      description: 'Cache the page (default: true)',
    },
    zeroDataRetention: {
      type: 'boolean',
      required: false,
      visibility: 'hidden',
      description: 'Enable zero data retention mode (default: false)',
    },
    scrapeOptions: {
      type: 'json',
      required: false,
      visibility: 'hidden',
      description: 'Options for content scraping (legacy, prefer top-level params)',
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
    body: (params) => {
      const body: Record<string, any> = {
        url: params.url,
        formats: params.formats || params.scrapeOptions?.formats || ['markdown'],
      }

      // Add all optional top-level parameters if provided
      if (params.onlyMainContent !== undefined) body.onlyMainContent = params.onlyMainContent
      if (params.includeTags !== undefined) body.includeTags = params.includeTags
      if (params.excludeTags !== undefined) body.excludeTags = params.excludeTags
      if (params.maxAge !== undefined) body.maxAge = params.maxAge
      if (params.headers !== undefined) body.headers = params.headers
      if (params.waitFor !== undefined) body.waitFor = params.waitFor
      if (params.mobile !== undefined) body.mobile = params.mobile
      if (params.skipTlsVerification !== undefined)
        body.skipTlsVerification = params.skipTlsVerification
      if (params.timeout !== undefined) body.timeout = params.timeout
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
