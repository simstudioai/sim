import type {
  ContextDevScrapeMarkdownParams,
  ContextDevScrapeMarkdownResponse,
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

export const contextDevScrapeMarkdownTool: ToolConfig<
  ContextDevScrapeMarkdownParams,
  ContextDevScrapeMarkdownResponse
> = {
  id: 'context_dev_scrape_markdown',
  name: 'Context.dev Scrape Markdown',
  description: 'Scrape any URL and return clean, LLM-ready markdown content.',
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
    includeLinks: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Preserve hyperlinks in the markdown output (default: true)',
    },
    includeImages: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include image references in the markdown output (default: false)',
    },
    includeFrames: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Render iframe contents inline (default: false)',
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
      const url = new URL(`${CONTEXT_DEV_BASE_URL}/web/scrape/markdown`)
      appendParam(url.searchParams, 'url', params.url)
      appendParam(url.searchParams, 'useMainContentOnly', params.useMainContentOnly)
      appendParam(url.searchParams, 'includeLinks', params.includeLinks)
      appendParam(url.searchParams, 'includeImages', params.includeImages)
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
        markdown: data.markdown ?? '',
        url: data.url ?? '',
        ...extractCreditMetadata(data.key_metadata),
      },
    }
  },

  outputs: {
    markdown: { type: 'string', description: 'Page content as clean markdown' },
    url: { type: 'string', description: 'The scraped URL' },
    ...CREDIT_OUTPUTS,
  },
}
