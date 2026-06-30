import type { ContextDevSearchParams, ContextDevSearchResponse } from '@/tools/context_dev/types'
import { SEARCH_RESULT_OUTPUT_PROPERTIES } from '@/tools/context_dev/types'
import {
  CONTEXT_DEV_BASE_URL,
  CREDIT_OUTPUTS,
  contextDevJsonHeaders,
  extractCreditMetadata,
  parseContextDevResponse,
} from '@/tools/context_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const contextDevSearchTool: ToolConfig<ContextDevSearchParams, ContextDevSearchResponse> = {
  id: 'context_dev_search',
  name: 'Context.dev Search',
  description: 'Search the web with natural language and optionally scrape results to markdown.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The natural language search query (1-500 characters)',
    },
    includeDomains: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return results from these domains',
    },
    excludeDomains: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclude results from these domains',
    },
    freshness: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Recency filter (last_24_hours, last_week, last_month, last_year)',
    },
    numResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (10-100, default 10)',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict results to a country (ISO 3166-1 alpha-2 code, e.g. US)',
    },
    queryFanout: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expand the query into parallel variants for broader coverage',
    },
    markdownEnabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Scrape each result page to markdown (default: false)',
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
    url: () => `${CONTEXT_DEV_BASE_URL}/web/search`,
    headers: (params) => contextDevJsonHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, any> = { query: params.query }
      if (params.includeDomains?.length) body.includeDomains = params.includeDomains
      if (params.excludeDomains?.length) body.excludeDomains = params.excludeDomains
      if (params.freshness) body.freshness = params.freshness
      if (params.numResults != null) {
        // Context.dev accepts 10-100 results — clamp to the documented bounds.
        const requested = Math.trunc(Number(params.numResults))
        if (Number.isFinite(requested)) {
          body.numResults = Math.min(100, Math.max(10, requested))
        }
      }
      if (params.country) body.country = String(params.country).trim().toUpperCase()
      if (params.queryFanout != null) body.queryFanout = params.queryFanout
      if (params.markdownEnabled != null) {
        body.markdownOptions = { enabled: params.markdownEnabled }
      }
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
        query: data.query ?? '',
        ...extractCreditMetadata(data.key_metadata),
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Search results with url, title, description, relevance, and optional markdown',
      items: { type: 'object', properties: SEARCH_RESULT_OUTPUT_PROPERTIES },
    },
    query: { type: 'string', description: 'The query that was searched' },
    ...CREDIT_OUTPUTS,
  },
}
