import type { ApolloAccountSearchParams, ApolloAccountSearchResponse } from '@/tools/apollo/types'
import type { ToolConfig } from '@/tools/types'

export const apolloAccountSearchTool: ToolConfig<
  ApolloAccountSearchParams,
  ApolloAccountSearchResponse
> = {
  id: 'apollo_account_search',
  name: 'Apollo Search Accounts',
  description:
    "Search your team's accounts in Apollo. Display limit: 50,000 records (100 records per page, 500 pages max). Use filters to narrow results. Master key required.",
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Apollo API key (master key required)',
    },
    q_keywords: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Keywords to search for in account data',
    },
    owner_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter by account owner user ID',
    },
    account_stage_ids: {
      type: 'array',
      required: false,
      visibility: 'user-only',
      description: 'Filter by account stage IDs',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page (max: 100)',
    },
  },

  request: {
    url: 'https://api.apollo.io/api/v1/accounts/search',
    method: 'POST',
    headers: (params: ApolloAccountSearchParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloAccountSearchParams) => {
      const body: any = {
        page: params.page || 1,
        per_page: Math.min(params.per_page || 25, 100),
      }
      if (params.q_keywords) body.q_keywords = params.q_keywords
      if (params.owner_id) body.owner_id = params.owner_id
      if (params.account_stage_ids?.length) {
        body.account_stage_ids = params.account_stage_ids
      }
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
        accounts: data.accounts || [],
        metadata: {
          page: data.pagination?.page || 1,
          per_page: data.pagination?.per_page || 25,
          total_entries: data.pagination?.total_entries || 0,
        },
      },
    }
  },

  outputs: {
    accounts: { type: 'json', description: 'Array of accounts matching the search criteria' },
    metadata: {
      type: 'json',
      description: 'Pagination information including page, per_page, and total_entries',
    },
  },
}
