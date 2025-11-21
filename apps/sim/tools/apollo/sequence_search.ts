import type { ApolloSequenceSearchParams, ApolloSequenceSearchResponse } from '@/tools/apollo/types'
import type { ToolConfig } from '@/tools/types'

export const apolloSequenceSearchTool: ToolConfig<
  ApolloSequenceSearchParams,
  ApolloSequenceSearchResponse
> = {
  id: 'apollo_sequence_search',
  name: 'Apollo Search Sequences',
  description: "Search for sequences/campaigns in your team's Apollo account (master key required)",
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Apollo API key (master key required)',
    },
    q_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search sequences by name',
    },
    active: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by active status (true for active sequences, false for inactive)',
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
    url: 'https://api.apollo.io/api/v1/emailer_campaigns/search',
    method: 'POST',
    headers: (params: ApolloSequenceSearchParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloSequenceSearchParams) => {
      const body: any = {
        page: params.page || 1,
        per_page: Math.min(params.per_page || 25, 100),
      }
      if (params.q_name) body.q_name = params.q_name
      if (params.active !== undefined) body.active = params.active
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
        sequences: data.emailer_campaigns || [],
        metadata: {
          page: data.pagination?.page || 1,
          per_page: data.pagination?.per_page || 25,
          total_entries: data.pagination?.total_entries || 0,
        },
      },
    }
  },

  outputs: {
    sequences: {
      type: 'json',
      description: 'Array of sequences/campaigns matching the search criteria',
    },
    metadata: {
      type: 'json',
      description: 'Pagination information including page, per_page, and total_entries',
    },
  },
}
