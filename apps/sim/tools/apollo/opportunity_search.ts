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
    q_keywords: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Keywords to search for in opportunity names',
    },
    account_ids: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by specific account IDs (e.g., ["acc_123", "acc_456"])',
    },
    stage_ids: {
      type: 'array',
      required: false,
      visibility: 'user-only',
      description: 'Filter by deal stage IDs',
    },
    owner_ids: {
      type: 'array',
      required: false,
      visibility: 'user-only',
      description: 'Filter by opportunity owner IDs',
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
    url: 'https://api.apollo.io/api/v1/opportunities/search',
    method: 'POST',
    headers: (params: ApolloOpportunitySearchParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloOpportunitySearchParams) => {
      const body: any = {
        page: params.page || 1,
        per_page: Math.min(params.per_page || 25, 100),
      }
      if (params.q_keywords) body.q_keywords = params.q_keywords
      if (params.account_ids?.length) body.account_ids = params.account_ids
      if (params.stage_ids?.length) body.stage_ids = params.stage_ids
      if (params.owner_ids?.length) body.owner_ids = params.owner_ids
      return body
    },
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
        opportunities: data.opportunities || [],
        page: data.pagination?.page || 1,
        per_page: data.pagination?.per_page || 25,
        total_entries: data.pagination?.total_entries || 0,
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
