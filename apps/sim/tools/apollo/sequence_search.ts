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
      visibility: 'user-only',
      description: 'Apollo API key (master key required)',
    },
    q_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search sequences by name (e.g., "Outbound Q1", "Follow-up")',
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
    url: (params: ApolloSequenceSearchParams) => {
      const qs = new URLSearchParams()
      qs.set('page', String(params.page || 1))
      qs.set('per_page', String(Math.min(params.per_page || 25, 100)))
      if (params.q_name) qs.set('q_name', params.q_name)
      return `https://api.apollo.io/api/v1/emailer_campaigns/search?${qs.toString()}`
    },
    method: 'POST',
    headers: (params: ApolloSequenceSearchParams) => ({
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
        sequences: data.emailer_campaigns || [],
        page: data.pagination?.page || 1,
        per_page: data.pagination?.per_page || 25,
        total_entries: data.pagination?.total_entries || 0,
      },
    }
  },

  outputs: {
    sequences: {
      type: 'json',
      description: 'Array of sequences/campaigns matching the search criteria',
    },
    page: { type: 'number', description: 'Current page number' },
    per_page: { type: 'number', description: 'Results per page' },
    total_entries: { type: 'number', description: 'Total matching entries' },
  },
}
