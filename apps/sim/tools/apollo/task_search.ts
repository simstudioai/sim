import type { ApolloTaskSearchParams, ApolloTaskSearchResponse } from '@/tools/apollo/types'
import type { ToolConfig } from '@/tools/types'

export const apolloTaskSearchTool: ToolConfig<ApolloTaskSearchParams, ApolloTaskSearchResponse> = {
  id: 'apollo_task_search',
  name: 'Apollo Search Tasks',
  description: 'Search for tasks in Apollo',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Apollo API key (master key required)',
    },
    contact_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by contact ID (e.g., "con_abc123")',
    },
    account_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by account ID (e.g., "acc_abc123")',
    },
    completed: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by completion status',
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
    url: 'https://api.apollo.io/api/v1/tasks/search',
    method: 'POST',
    headers: (params: ApolloTaskSearchParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloTaskSearchParams) => {
      const body: any = {
        page: params.page || 1,
        per_page: Math.min(params.per_page || 25, 100),
      }
      if (params.contact_id) body.contact_id = params.contact_id
      if (params.account_id) body.account_id = params.account_id
      if (params.completed !== undefined) body.completed = params.completed
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
        tasks: data.tasks ?? null,
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    tasks: {
      type: 'json',
      description: 'Array of tasks matching the search criteria',
      optional: true,
    },
    pagination: { type: 'json', description: 'Pagination information', optional: true },
  },
}
