import type {
  ContextDevScrapeHtmlParams,
  ContextDevScrapeHtmlResponse,
} from '@/tools/context_dev/types'
import {
  appendParam,
  CONTEXT_DEV_BASE_URL,
  CREDIT_OUTPUTS,
  contextDevHeaders,
  extractCreditMetadata,
  parseContextDevResponse,
} from '@/tools/context_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const contextDevScrapeHtmlTool: ToolConfig<
  ContextDevScrapeHtmlParams,
  ContextDevScrapeHtmlResponse
> = {
  id: 'context_dev_scrape_html',
  name: 'Context.dev Scrape HTML',
  description: 'Scrape any URL and return the raw HTML content of the page.',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The full URL to scrape (must include http:// or https://)',
    },
    useMainContentOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only main content, excluding headers, footers, and navigation',
    },
    includeFrames: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Render iframe contents inline into the returned HTML (default: false)',
    },
    maxAgeMs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cache duration in milliseconds (0-2592000000, default: 86400000)',
    },
    waitForMs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Browser wait time after page load in milliseconds (0-30000)',
    },
    timeoutMS: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Request timeout in milliseconds (1000-300000)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Context.dev API key',
    },
  },

  request: {
    method: 'GET',
    url: (params) => {
      const url = new URL(`${CONTEXT_DEV_BASE_URL}/web/scrape/html`)
      appendParam(url.searchParams, 'url', params.url)
      appendParam(url.searchParams, 'useMainContentOnly', params.useMainContentOnly)
      appendParam(url.searchParams, 'includeFrames', params.includeFrames)
      appendParam(url.searchParams, 'maxAgeMs', params.maxAgeMs)
      appendParam(url.searchParams, 'waitForMs', params.waitForMs)
      appendParam(url.searchParams, 'timeoutMS', params.timeoutMS)
      return url.toString()
    },
    headers: (params) => contextDevHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await parseContextDevResponse(response)
    return {
      success: true,
      output: {
        html: data.html ?? '',
        url: data.url ?? '',
        type: data.type ?? 'html',
        ...extractCreditMetadata(data.key_metadata),
      },
    }
  },

  outputs: {
    html: { type: 'string', description: 'Raw HTML content of the page' },
    url: { type: 'string', description: 'The scraped URL' },
    type: {
      type: 'string',
      description:
        'Detected content type (html, xml, json, text, csv, markdown, svg, pdf, doc, docx)',
    },
    ...CREDIT_OUTPUTS,
  },
}
