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
    contact_label_ids: {
      type: 'array',
      required: false,
      visibility: 'user-only',
      description: 'Filter by Apollo label IDs (lists)',
    },
    sort_by_field: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Sort field: contact_last_activity_date, contact_email_last_opened_at, contact_email_last_clicked_at, contact_created_at, or contact_updated_at',
    },
    sort_ascending: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'When true, sort ascending. Must be used together with sort_by_field',
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
      const body: Record<string, unknown> = {
        page: params.page || 1,
        per_page: Math.min(params.per_page || 25, 100),
      }
      if (params.q_keywords) body.q_keywords = params.q_keywords
      if (params.contact_stage_ids?.length) {
        body.contact_stage_ids = params.contact_stage_ids
      }
      if (params.contact_label_ids?.length) {
        body.contact_label_ids = params.contact_label_ids
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
        contacts: data.contacts ?? [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    contacts: {
      type: 'json',
      description: 'Array of contacts matching the search criteria',
    },
    pagination: { type: 'json', description: 'Pagination information', optional: true },
  },
}
