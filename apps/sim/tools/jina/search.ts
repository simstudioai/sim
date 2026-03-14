import type { SearchParams, SearchResponse } from '@/tools/jina/types'
import { JINA_SEARCH_RESULT_OUTPUT_PROPERTIES } from '@/tools/jina/types'
import type { ToolConfig } from '@/tools/types'

export const searchTool: ToolConfig<SearchParams, SearchResponse> = {
  id: 'jina_search',
  name: 'Jina Search',
  description:
    'Search the web and return top 5 results with LLM-friendly content. Each result is automatically processed through Jina Reader API. Supports geographic filtering, site restrictions, and pagination.',
  version: '1.0.0',

  params: {
    q: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query string (e.g., "machine learning tutorials")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Jina AI API key',
    },
    // Pagination
    num: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of results per page (default: 5)',
    },
    // Site restriction
    site: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Restrict results to specific domain(s). Can be comma-separated for multiple sites (e.g., "jina.ai,github.com")',
    },
    // Content options
    withFavicon: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include website favicons in results',
    },
    withImagesummary: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Gather all images from result pages with metadata',
    },
    withLinksummary: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Gather all links from result pages',
    },
    retainImages: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Control image inclusion: "none" removes all, "all" keeps all',
    },
    noCache: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Bypass cached content for real-time retrieval',
    },
    withGeneratedAlt: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Generate alt text for images using VLM',
    },
    respondWith: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Set to "no-content" to get only metadata without page content',
    },
    returnFormat: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Output format: markdown, html, text, screenshot, or pageshot',
    },
  },

  request: {
    url: (params: SearchParams) => {
      const baseUrl = 'https://s.jina.ai/'
      const query = encodeURIComponent(params.q)

      // Build query params
      const queryParams: string[] = []

      // Handle site parameter (can be string or array)
      if (params.site) {
        const sites = typeof params.site === 'string' ? params.site.split(',') : params.site
        sites.forEach((s) => queryParams.push(`site=${encodeURIComponent(s.trim())}`))
      }

      const queryString = queryParams.length > 0 ? `?${queryParams.join('&')}` : ''
      return `${baseUrl}${query}${queryString}`
    },
    method: 'GET',
    headers: (params: SearchParams) => {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }

      // Content options
      if (params.withFavicon === true) {
        headers['X-With-Favicon'] = 'true'
      }
      if (params.withImagesummary === true) {
        headers['X-With-Images-Summary'] = 'true'
      }
      if (params.withLinksummary === true) {
        headers['X-With-Links-Summary'] = 'true'
      }
      if (params.retainImages) {
        headers['X-Retain-Images'] = params.retainImages
      }
      if (params.noCache === true) {
        headers['X-No-Cache'] = 'true'
      }
      if (params.withGeneratedAlt === true) {
        headers['X-With-Generated-Alt'] = 'true'
      }
      if (params.respondWith) {
        headers['X-Respond-With'] = params.respondWith
      }
      if (params.returnFormat) {
        headers['X-Return-Format'] = params.returnFormat
      }

      // Pagination headers
      if (params.num) {
        headers['X-Num'] = params.num.toString()
      }

      return headers
    },
  },

  hosting: {
    envKeyPrefix: 'JINA_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'jina',
    pricing: {
      type: 'custom',
      getCost: (_params, output) => {
        if (output.tokensUsed == null) {
          throw new Error('Jina search response missing tokensUsed field')
        }
        // Jina bills per output token — $0.20 per 1M tokens
        // Search costs a fixed minimum of 10,000 tokens per request
        // Source: https://cloud.jina.ai/pricing (token-based billing)
        // x-tokens header is unreliable; falls back to content-length estimate (~4 chars/token)
        const tokens = output.tokensUsed as number
        const cost = tokens * 0.0000002
        return { cost, metadata: { tokensUsed: tokens } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 40,
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    let tokensUsed: number | undefined
    const tokensHeader = response.headers.get('x-tokens')
    if (tokensHeader) {
      const parsed = Number.parseInt(tokensHeader, 10)
      if (!Number.isNaN(parsed) && parsed > 0) {
        tokensUsed = parsed
      }
    }

    const results = Array.isArray(data) ? data : data.data || []

    if (tokensUsed == null) {
      let total = 0
      for (const result of results) {
        if (result.usage?.tokens) {
          total += result.usage.tokens
        }
      }
      if (total > 0) {
        tokensUsed = total
      }
    }

    if (tokensUsed == null) {
      let totalChars = 0
      for (const result of results) {
        totalChars += (result.content?.length ?? 0) + (result.title?.length ?? 0)
      }
      tokensUsed = Math.max(Math.ceil(totalChars / 4), 10000)
    }

    return {
      success: response.ok,
      output: {
        results: results.map((result: any) => ({
          title: result.title || '',
          description: result.description || '',
          url: result.url || '',
          content: result.content || '',
        })),
        tokensUsed,
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description:
        'Array of search results, each containing title, description, url, and LLM-friendly content',
      items: {
        type: 'object',
        properties: JINA_SEARCH_RESULT_OUTPUT_PROPERTIES,
      },
    },
    tokensUsed: {
      type: 'number',
      description: 'Number of Jina tokens consumed by this request',
      optional: true,
    },
  },
}
