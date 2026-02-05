import type { ApolloContactSearchParams, ApolloContactSearchResponse } from '@/tools/apollo/types'
import type { ToolConfig } from '@/tools/types'

export const apolloContactSearchTool: ToolConfig<
  ApolloContactSearchParams,
  ApolloContactSearchResponse
> = {
  id: 'apollo_contact_search',
  name: 'Apollo Search Contacts',
  description: "Search your team's contacts in Apollo",
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
      description: 'Keywords to search for',
    },
    contact_stage_ids: {
      type: 'array',
      required: false,
      visibility: 'user-only',
      description: 'Filter by contact stage IDs',
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
    url: 'https://api.apollo.io/api/v1/contacts/search',
    method: 'POST',
    headers: (params: ApolloContactSearchParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloContactSearchParams) => {
      const body: any = {
        page: params.page || 1,
        per_page: Math.min(params.per_page || 25, 100),
      }
      if (params.q_keywords) body.q_keywords = params.q_keywords
      if (params.contact_stage_ids?.length) {
        body.contact_stage_ids = params.contact_stage_ids
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
        contacts: data.contacts ?? null,
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    contacts: {
      type: 'json',
      description: 'Array of contacts matching the search criteria',
      optional: true,
    },
    pagination: { type: 'json', description: 'Pagination information', optional: true },
  },
}
