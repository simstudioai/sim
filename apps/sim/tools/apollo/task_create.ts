import type { ApolloTaskCreateParams, ApolloTaskCreateResponse } from '@/tools/apollo/types'
import type { ToolConfig } from '@/tools/types'

export const apolloTaskCreateTool: ToolConfig<ApolloTaskCreateParams, ApolloTaskCreateResponse> = {
  id: 'apollo_task_create',
  name: 'Apollo Create Task',
  description: 'Create one or more tasks in Apollo (one task per contact_id, master key required)',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Apollo API key (master key required)',
    },
    user_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the Apollo user the task is assigned to',
    },
    contact_ids: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of contact IDs. One task is created per contact.',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Task priority: "high", "medium", or "low" (defaults to "medium")',
    },
    due_at: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Due date/time in ISO 8601 format (e.g., "2024-12-31T23:59:59Z")',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Task type: "call", "outreach_manual_email", "linkedin_step_connect", "linkedin_step_message", "linkedin_step_view_profile", "linkedin_step_interact_post", or "action_item"',
    },
    status: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Task status: "scheduled", "completed", or "skipped"',
    },
    note: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-form note providing context for the task',
    },
  },

  request: {
    url: 'https://api.apollo.io/api/v1/tasks/bulk_create',
    method: 'POST',
    headers: (params: ApolloTaskCreateParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloTaskCreateParams) => {
      const body: Record<string, unknown> = {
        user_id: params.user_id,
        contact_ids: params.contact_ids,
        priority: params.priority || 'medium',
        due_at: params.due_at,
        type: params.type,
        status: params.status,
      }
      if (params.note) body.note = params.note
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Apollo API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json().catch(() => null)
    const tasks = Array.isArray(data?.tasks) ? data.tasks : []

    return {
      success: true,
      output: {
        tasks,
        created: true,
      },
    }
  },

  outputs: {
    tasks: { type: 'json', description: 'Array of created tasks (when returned by Apollo)' },
    created: { type: 'boolean', description: 'Whether the request succeeded' },
  },
}
