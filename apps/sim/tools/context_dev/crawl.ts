import type { ContextDevCrawlParams, ContextDevCrawlResponse } from '@/tools/context_dev/types'
import { CRAWL_RESULT_OUTPUT_PROPERTIES } from '@/tools/context_dev/types'
import {
  CONTEXT_DEV_BASE_URL,
  CREDIT_OUTPUTS,
  contextDevJsonHeaders,
  extractCreditMetadata,
  parseContextDevResponse,
} from '@/tools/context_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const contextDevCrawlTool: ToolConfig<ContextDevCrawlParams, ContextDevCrawlResponse> = {
  id: 'context_dev_crawl',
  name: 'Context.dev Crawl',
  description: 'Crawl an entire website and return each discovered page as clean markdown.',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The starting URL to crawl (must include http:// or https://)',
    },
    maxPages: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of pages to crawl (1-500, default: 100)',
    },
    maxDepth: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum link depth from the starting URL (0 = start page only)',
    },
    urlRegex: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Regex pattern to filter which URLs are crawled',
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
    useMainContentOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Strip headers, footers, and sidebars from each page (default: false)',
    },
    followSubdomains: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Follow links to subdomains of the starting domain (default: false)',
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
    stopAfterMs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Soft crawl time budget in milliseconds (10000-110000, default: 80000)',
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
    method: 'POST',
    url: () => `${CONTEXT_DEV_BASE_URL}/web/crawl`,
    headers: (params) => contextDevJsonHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, any> = { url: params.url }
      if (params.maxPages != null) body.maxPages = params.maxPages
      if (params.maxDepth != null) body.maxDepth = params.maxDepth
      if (params.urlRegex) body.urlRegex = params.urlRegex
      if (params.includeLinks != null) body.includeLinks = params.includeLinks
      if (params.includeImages != null) body.includeImages = params.includeImages
      if (params.useMainContentOnly != null) body.useMainContentOnly = params.useMainContentOnly
      if (params.followSubdomains != null) body.followSubdomains = params.followSubdomains
      if (params.maxAgeMs != null) body.maxAgeMs = params.maxAgeMs
      if (params.waitForMs != null) body.waitForMs = params.waitForMs
      if (params.stopAfterMs != null) body.stopAfterMs = params.stopAfterMs
      if (params.timeoutMS != null) body.timeoutMS = params.timeoutMS
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await parseContextDevResponse(response)
    return {
      success: true,
      output: {
        results: data.results ?? [],
        metadata: data.metadata ?? {},
        ...extractCreditMetadata(data.key_metadata),
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Crawled pages with markdown content and per-page metadata',
      items: { type: 'object', properties: CRAWL_RESULT_OUTPUT_PROPERTIES },
    },
    metadata: {
      type: 'object',
      description: 'Crawl summary (numUrls, maxCrawlDepth, numSucceeded, numFailed, numSkipped)',
    },
    ...CREDIT_OUTPUTS,
  },
}
