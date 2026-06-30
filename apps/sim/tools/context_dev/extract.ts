import type { ContextDevExtractParams, ContextDevExtractResponse } from '@/tools/context_dev/types'
import {
  CONTEXT_DEV_BASE_URL,
  CREDIT_OUTPUTS,
  contextDevJsonHeaders,
  extractCreditMetadata,
  parseContextDevResponse,
} from '@/tools/context_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const contextDevExtractTool: ToolConfig<ContextDevExtractParams, ContextDevExtractResponse> =
  {
    id: 'context_dev_extract',
    name: 'Context.dev Extract',
    description: 'Crawl a website and extract structured data matching a provided JSON schema.',
    version: '1.0.0',

    params: {
      url: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The starting website URL (must include http:// or https://)',
      },
      schema: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description: 'JSON Schema describing the structure of the data to extract',
      },
      instructions: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Optional extraction guidance for link prioritization (max 2000 chars)',
      },
      factCheck: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Require extracted values to be grounded in page facts (default: false)',
      },
      followSubdomains: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Follow links on subdomains of the starting domain (default: false)',
      },
      maxPages: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum number of pages to analyze (1-50, default: 5)',
      },
      maxDepth: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum link depth from the starting URL',
      },
      maxAgeMs: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Cache duration in milliseconds (0-2592000000, default: 604800000)',
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
      url: () => `${CONTEXT_DEV_BASE_URL}/web/extract`,
      headers: (params) => contextDevJsonHeaders(params.apiKey),
      body: (params) => {
        const body: Record<string, any> = { url: params.url, schema: params.schema }
        if (params.instructions) body.instructions = params.instructions
        if (params.factCheck != null) body.factCheck = params.factCheck
        if (params.followSubdomains != null) body.followSubdomains = params.followSubdomains
        if (params.maxPages != null) body.maxPages = params.maxPages
        if (params.maxDepth != null) body.maxDepth = params.maxDepth
        if (params.maxAgeMs != null) body.maxAgeMs = params.maxAgeMs
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
          status: data.status ?? '',
          url: data.url ?? '',
          urlsAnalyzed: data.urls_analyzed ?? [],
          data: data.data ?? {},
          metadata: data.metadata ?? {},
          ...extractCreditMetadata(data.key_metadata),
        },
      }
    },

    outputs: {
      status: { type: 'string', description: 'Extraction status' },
      url: { type: 'string', description: 'The starting URL that was crawled' },
      urlsAnalyzed: {
        type: 'array',
        description: 'URLs that were analyzed during extraction',
        items: { type: 'string', description: 'Analyzed page URL' },
      },
      data: { type: 'json', description: 'Structured data matching the requested schema' },
      metadata: {
        type: 'object',
        description: 'Crawl summary (numUrls, maxCrawlDepth, numSucceeded, numFailed, numSkipped)',
      },
      ...CREDIT_OUTPUTS,
    },
  }
