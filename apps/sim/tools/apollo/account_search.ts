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
    q_organization_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter accounts by organization name (partial-match search)',
    },
    account_stage_ids: {
      type: 'array',
      required: false,
      visibility: 'user-only',
      description: 'Filter by account stage IDs',
    },
    account_label_ids: {
      type: 'array',
      required: false,
      visibility: 'user-only',
      description: 'Filter by account label IDs',
    },
    sort_by_field: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort field: "account_last_activity_date", "account_created_at", or "account_updated_at"',
    },
    sort_ascending: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort ascending when true. Defaults to descending.',
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
    url: 'https://api.apollo.io/api/v1/accounts/search',
    method: 'POST',
    headers: (params: ApolloAccountSearchParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloAccountSearchParams) => {
      const body: Record<string, unknown> = {
        page: params.page || 1,
        per_page: Math.min(params.per_page || 25, 100),
      }
      if (params.q_organization_name) body.q_organization_name = params.q_organization_name
      if (params.account_stage_ids?.length) {
        body.account_stage_ids = params.account_stage_ids
      }
      if (params.account_label_ids?.length) {
        body.account_label_ids = params.account_label_ids
      }
      if (params.sort_by_field) body.sort_by_field = params.sort_by_field
      if (params.sort_ascending !== undefined) body.sort_ascending = params.sort_ascending
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
        accounts: data.accounts ?? [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    accounts: {
      type: 'json',
      description: 'Array of accounts matching the search criteria',
    },
    pagination: { type: 'json', description: 'Pagination information', optional: true },
  },
}
