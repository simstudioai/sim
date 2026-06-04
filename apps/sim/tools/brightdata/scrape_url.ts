import type {
  BrightDataScrapeUrlParams,
  BrightDataScrapeUrlResponse,
} from '@/tools/brightdata/types'
import type { ToolConfig } from '@/tools/types'

export const brightDataScrapeUrlTool: ToolConfig<
  BrightDataScrapeUrlParams,
  BrightDataScrapeUrlResponse
> = {
  id: 'brightdata_scrape_url',
  name: 'Bright Data Scrape URL',
  description:
    'Fetch content from any URL using Bright Data Web Unlocker. Bypasses anti-bot protections, CAPTCHAs, and IP blocks automatically.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Bright Data API token',
    },
    zone: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Web Unlocker zone name from your Bright Data dashboard (e.g., "web_unlocker1")',
    },
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The URL to scrape (e.g., "https://example.com/page")',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Response format: "raw" for HTML or "json" for parsed content. Defaults to "raw"',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Two-letter country code for geo-targeting (e.g., "us", "gb")',
    },
  },

  request: {
    method: 'POST',
    url: 'https://api.brightdata.com/request',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        zone: params.zone,
        url: params.url,
        format: params.format || 'raw',
      }
      if (params.country) body.country = params.country
      return body
    },
  },

  transformResponse: async (response: Response, params) => {
    const contentType = response.headers.get('content-type') || ''

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(errorText || `Request failed with status ${response.status}`)
    }

    let content: string
    if (contentType.includes('application/json')) {
      const data = await response.json()
      content = typeof data === 'string' ? data : JSON.stringify(data)
    } else {
      content = await response.text()
    }

    return {
      success: true,
      output: {
        content,
        url: params?.url ?? null,
        statusCode: response.status,
      },
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'The scraped page content (HTML or JSON depending on format)',
    },
    url: { type: 'string', description: 'The URL that was scraped', optional: true },
    statusCode: { type: 'number', description: 'HTTP status code of the response', optional: true },
  },
}
