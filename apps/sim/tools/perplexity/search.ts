import type { PerplexitySearchParams, PerplexitySearchResponse } from '@/tools/perplexity/types'
import type { ToolConfig } from '@/tools/types'

export const searchTool: ToolConfig<PerplexitySearchParams, PerplexitySearchResponse> = {
  id: 'perplexity_search',
  name: 'Perplexity Search',
  description:
    "Get ranked search results from Perplexity's continuously refreshed index with advanced filtering and customization options",
  version: '1.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'A search query or array of queries (max 5 for multi-query search)',
    },
    max_results: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of search results to return (1-20, default: 10)',
    },
    search_domain_filter: {
      type: 'array',
      required: false,
      visibility: 'user-only',
      description: 'List of domains/URLs to limit search results to (max 20)',
    },
    max_tokens_per_page: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of tokens retrieved from each webpage (default: 1024)',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Country code to filter search results (e.g., US, GB, DE)',
    },
    search_recency_filter: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter results by recency: hour, day, week, month, or year',
    },
    search_after_date: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Include only content published after this date (format: MM/DD/YYYY)',
    },
    search_before_date: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Include only content published before this date (format: MM/DD/YYYY)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Perplexity API key',
    },
  },

  request: {
    method: 'POST',
    url: () => 'https://api.perplexity.ai/search',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {
        query: params.query,
      }

      if (params.max_results !== undefined) {
        body.max_results = Number(params.max_results)
      }

      if (params.search_domain_filter && params.search_domain_filter.length > 0) {
        body.search_domain_filter = params.search_domain_filter
      }

      if (params.max_tokens_per_page !== undefined) {
        body.max_tokens_per_page = Number(params.max_tokens_per_page)
      }

      if (params.country) {
        body.country = params.country
      }

      if (params.search_recency_filter) {
        body.search_recency_filter = params.search_recency_filter
      }

      if (params.search_after_date) {
        body.search_after_date = params.search_after_date
      }

      if (params.search_before_date) {
        body.search_before_date = params.search_before_date
      }

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        results: data.results.map((result: any) => ({
          title: result.title,
          url: result.url,
          snippet: result.snippet,
          date: result.date,
          last_updated: result.last_updated,
        })),
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Search results',
      properties: {
        results: {
          type: 'array',
          description: 'Array of search results',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Title of the search result' },
              url: { type: 'string', description: 'URL of the search result' },
              snippet: { type: 'string', description: 'Brief excerpt or summary of the content' },
              date: {
                type: 'string',
                description: "Date the page was crawled and added to Perplexity's index",
              },
              last_updated: {
                type: 'string',
                description: "Date the page was last updated in Perplexity's index",
              },
            },
          },
        },
      },
    },
  },
}
