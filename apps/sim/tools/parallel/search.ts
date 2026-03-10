import type { ParallelSearchParams } from '@/tools/parallel/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export const searchTool: ToolConfig<ParallelSearchParams, ToolResponse> = {
  id: 'parallel_search',
  name: 'Parallel AI Search',
  description:
    'Search the web using Parallel AI. Provides comprehensive search results with intelligent processing and content extraction.',
  version: '1.0.0',

  params: {
    objective: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search objective or question to answer',
    },
    search_queries: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of search queries to execute',
    },
    mode: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Search mode: one-shot, agentic, or fast (default: one-shot)',
    },
    max_results: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of results to return (default: 10)',
    },
    max_chars_per_result: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum characters per result excerpt (minimum: 1000)',
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
    url: 'https://api.parallel.ai/v1beta/search',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
      'parallel-beta': 'search-extract-2025-10-10',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        objective: params.objective,
      }

      if (params.search_queries) {
        if (Array.isArray(params.search_queries)) {
          body.search_queries = params.search_queries
        } else if (typeof params.search_queries === 'string') {
          const queries = params.search_queries
            .split(',')
            .map((q: string) => q.trim())
            .filter((q: string) => q.length > 0)
          if (queries.length > 0) body.search_queries = queries
        }
      }

      if (params.mode) body.mode = params.mode
      if (params.max_results) body.max_results = Number(params.max_results)
      if (params.max_chars_per_result) {
        body.excerpts = { max_chars_per_result: Number(params.max_chars_per_result) }
      }

      const sourcePolicy: Record<string, string[]> = {}
      if (params.include_domains) {
        sourcePolicy.include_domains = params.include_domains
          .split(',')
          .map((d: string) => d.trim())
          .filter((d: string) => d.length > 0)
      }
      if (params.exclude_domains) {
        sourcePolicy.exclude_domains = params.exclude_domains
          .split(',')
          .map((d: string) => d.trim())
          .filter((d: string) => d.length > 0)
      }
      if (Object.keys(sourcePolicy).length > 0) {
        body.source_policy = sourcePolicy
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Parallel AI search failed: ${response.status} - ${errorText}`)
    }

    const data = await response.json()

    if (!data.results) {
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
          title: { type: 'string', description: 'The title of the search result' },
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
