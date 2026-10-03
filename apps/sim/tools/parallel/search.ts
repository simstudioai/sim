import type { ParallelSearchParams } from '@/tools/parallel/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

/**
 * Search modes that existed only on the retired `/v1beta/search` endpoint,
 * mapped onto their V1 equivalents per Parallel's migration guide.
 *
 * Source: https://docs.parallel.ai/search/search-migration-guide
 */
const LEGACY_MODE_MAP: Record<string, string> = {
  'one-shot': 'basic',
  agentic: 'advanced',
}

/**
 * Base price of one V1 search request per mode. Each request includes up to
 * ten results; results beyond that cost `ADDITIONAL_RESULT_COST_USD` apiece.
 *
 * Source: https://docs.parallel.ai/getting-started/pricing
 */
const MODE_BASE_COST_USD: Record<string, number> = {
  turbo: 0.001,
  fast: 0.001,
  basic: 0.005,
  advanced: 0.005,
}

const DEFAULT_MODE = 'advanced'
const INCLUDED_RESULTS = 10
const ADDITIONAL_RESULT_COST_USD = 0.001

/**
 * Maps a caller-supplied mode onto a V1 mode, translating retired beta names.
 * Returns undefined when nothing was supplied so the API default applies.
 */
export function resolveSearchMode(mode: string | undefined): string | undefined {
  if (!mode) return undefined
  return LEGACY_MODE_MAP[mode] ?? mode
}

/**
 * Splits a comma-separated string (or passes through an array) into a list of
 * trimmed, non-empty entries.
 */
export function toList(value: string[] | string | undefined): string[] {
  if (!value) return []
  const entries = Array.isArray(value) ? value : value.split(',')
  return entries.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0)
}

export const searchTool: ToolConfig<ParallelSearchParams, ToolResponse> = {
  id: 'parallel_search',
  name: 'Parallel AI Search',
  description:
    'Search the web using Parallel AI. Provides comprehensive search results with intelligent processing and content extraction.',
  version: '1.0.0',

  hosting: {
    envKeyPrefix: 'PARALLEL_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'parallel_ai',
    pricing: {
      type: 'custom',
      getCost: (params, output) => {
        if (!Array.isArray(output.results)) {
          throw new Error('Parallel search response missing results array')
        }
        const mode = resolveSearchMode(params.mode) ?? DEFAULT_MODE
        const baseCost = MODE_BASE_COST_USD[mode] ?? MODE_BASE_COST_USD[DEFAULT_MODE]
        const resultCount = output.results.length
        const additionalResults = Math.max(0, resultCount - INCLUDED_RESULTS)
        const cost = baseCost + additionalResults * ADDITIONAL_RESULT_COST_USD
        return { cost, metadata: { mode, resultCount, additionalResults } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 30,
    },
  },

  params: {
    search_queries: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of concise keyword search queries (3-6 words each). At least one is required',
    },
    objective: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Natural-language description of the search intent used to rank and excerpt results',
    },
    mode: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: `Search mode: turbo, fast, basic, or advanced (default: ${DEFAULT_MODE})`,
    },
    max_results: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of results to return (default: 10, max: 20)',
    },
    max_chars_per_result: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum characters of excerpts per result',
    },
    include_domains: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of domains to restrict search results to',
    },
    exclude_domains: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of domains to exclude from search results',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Parallel AI API Key',
    },
  },

  request: {
    url: 'https://api.parallel.ai/v1/search',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        search_queries: toList(params.search_queries),
      }

      if (params.objective) body.objective = params.objective

      const mode = resolveSearchMode(params.mode)
      if (mode) body.mode = mode

      const advancedSettings: Record<string, unknown> = {}
      if (params.max_results) advancedSettings.max_results = Number(params.max_results)
      if (params.max_chars_per_result) {
        advancedSettings.excerpt_settings = {
          max_chars_per_result: Number(params.max_chars_per_result),
        }
      }

      const sourcePolicy: Record<string, string[]> = {}
      const includeDomains = toList(params.include_domains)
      const excludeDomains = toList(params.exclude_domains)
      if (includeDomains.length > 0) sourcePolicy.include_domains = includeDomains
      if (excludeDomains.length > 0) sourcePolicy.exclude_domains = excludeDomains
      if (Object.keys(sourcePolicy).length > 0) advancedSettings.source_policy = sourcePolicy

      if (Object.keys(advancedSettings).length > 0) body.advanced_settings = advancedSettings

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Parallel AI search failed: ${response.status} - ${errorText}`)
    }

    const data = await response.json()

    if (!Array.isArray(data.results)) {
      return {
        success: false,
        error: 'No results returned from search',
        output: {
          results: [],
          search_id: data.search_id ?? null,
        },
      }
    }

    return {
      success: true,
      output: {
        search_id: data.search_id ?? null,
        results: data.results.map((result: Record<string, unknown>) => ({
          url: result.url ?? null,
          title: result.title ?? null,
          publish_date: result.publish_date ?? null,
          excerpts: result.excerpts ?? [],
        })),
      },
    }
  },

  outputs: {
    search_id: {
      type: 'string',
      description: 'Unique identifier for this search request',
    },
    results: {
      type: 'array',
      description: 'Search results with excerpts from relevant pages',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL of the search result' },
          title: { type: 'string', description: 'The title of the search result', optional: true },
          publish_date: {
            type: 'string',
            description: 'Publication date of the page (YYYY-MM-DD)',
            optional: true,
          },
          excerpts: {
            type: 'array',
            description: 'LLM-optimized excerpts from the page',
            items: { type: 'string' },
          },
        },
      },
    },
  },
}
