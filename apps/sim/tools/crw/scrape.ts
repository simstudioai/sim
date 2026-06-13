import { resolveCrwBaseUrl } from '@/tools/crw/base-url'
import type { ScrapeParams, ScrapeResponse } from '@/tools/crw/types'
import { PAGE_METADATA_OUTPUT_PROPERTIES } from '@/tools/crw/types'
import { safeAssign } from '@/tools/safe-assign'
import type { ToolConfig } from '@/tools/types'

export const scrapeTool: ToolConfig<ScrapeParams, ScrapeResponse> = {
  id: 'crw_scrape',
  name: 'fastCRW Website Scraper',
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
    baseUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Base URL for self-hosted fastCRW (defaults to https://fastcrw.com/api)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'fastCRW API key',
    },
  },

  hosting: {
    envKeyPrefix: 'CRW_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'crw',
    // fastCRW is BYOK-only — Sim does not meter usage.
    pricing: { type: 'per_request', cost: 0 },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 100,
    },
  },

  request: {
    method: 'POST',
    url: (params) => `${resolveCrwBaseUrl(params.baseUrl)}/v1/scrape`,
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
      if (params.headers) body.headers = params.headers
      if (params.waitFor) body.waitFor = Number(params.waitFor)
      if (params.renderJs != null) body.renderJs = params.renderJs
      if (params.cssSelector) body.cssSelector = params.cssSelector
      if (params.xpath) body.xpath = params.xpath
      if (params.jsonSchema) body.jsonSchema = params.jsonSchema
      if (params.proxy) body.proxy = params.proxy
      if (typeof params.stealth === 'boolean') body.stealth = params.stealth

      if (params.scrapeOptions) {
        safeAssign(body, params.scrapeOptions as Record<string, unknown>)
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const result = data.data ?? data

    return {
      success: data.success !== false,
      error: data.success === false ? data.error || 'fastCRW scrape failed' : undefined,
      output: {
        markdown: result.markdown,
        html: result.html,
        metadata: result.metadata,
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
