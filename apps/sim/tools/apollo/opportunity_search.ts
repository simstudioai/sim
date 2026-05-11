import type {
  ApolloOpportunitySearchParams,
  ApolloOpportunitySearchResponse,
} from '@/tools/apollo/types'
import type { ToolConfig } from '@/tools/types'

export const apolloOpportunitySearchTool: ToolConfig<
  ApolloOpportunitySearchParams,
  ApolloOpportunitySearchResponse
> = {
  id: 'apollo_opportunity_search',
  name: 'Apollo Search Opportunities',
  description: "Search and list all deals/opportunities in your team's Apollo account",
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Apollo API key',
    },
    sort_by_field: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort field: "amount", "is_closed", or "is_won"',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination (e.g., 1, 2, 3)',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page, max 100 (e.g., 25, 50, 100)',
    },
  },

  request: {
    url: (params: ApolloOpportunitySearchParams) => {
      const query = new URLSearchParams()
      query.set('page', String(params.page || 1))
      query.set('per_page', String(Math.min(params.per_page || 25, 100)))
      if (params.sort_by_field) query.set('sort_by_field', params.sort_by_field)
      return `https://api.apollo.io/api/v1/opportunities/search?${query.toString()}`
    },
    method: 'GET',
    headers: (params: ApolloOpportunitySearchParams) => ({
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Apollo API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        opportunities: data.opportunities ?? [],
        page: data.pagination?.page ?? 1,
        per_page: data.pagination?.per_page ?? 25,
        total_entries: data.pagination?.total_entries ?? 0,
      },
    }
  },

  outputs: {
    opportunities: {
      type: 'json',
      description: 'Array of opportunities matching the search criteria',
    },
    page: { type: 'number', description: 'Current page number' },
    per_page: { type: 'number', description: 'Results per page' },
    total_entries: { type: 'number', description: 'Total matching entries' },
  },
}
