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
    sort_by_field: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort field: "task_due_at" or "task_priority"',
    },
    open_factor_names: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by status. Common values: ["task_types"] for open tasks, ["task_completed_at"] for completed tasks.',
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
      const body: Record<string, unknown> = {
        page: params.page || 1,
        per_page: Math.min(params.per_page || 25, 100),
      }
      if (params.sort_by_field) body.sort_by_field = params.sort_by_field
      if (params.open_factor_names?.length) body.open_factor_names = params.open_factor_names
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
        tasks: data.tasks ?? [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    tasks: {
      type: 'json',
      description: 'Array of tasks matching the search criteria',
    },
    pagination: { type: 'json', description: 'Pagination information', optional: true },
  },
}
