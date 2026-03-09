import type { ApolloTaskCreateParams, ApolloTaskCreateResponse } from '@/tools/apollo/types'
import type { ToolConfig } from '@/tools/types'

export const apolloTaskCreateTool: ToolConfig<ApolloTaskCreateParams, ApolloTaskCreateResponse> = {
  id: 'apollo_task_create',
  name: 'Apollo Create Task',
  description: 'Create a new task in Apollo',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Apollo API key (master key required)',
    },
    note: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Task note/description',
    },
    contact_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Contact ID to associate with (e.g., "con_abc123")',
    },
    account_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Account ID to associate with (e.g., "acc_abc123")',
    },
    due_at: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Due date in ISO format',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Task priority',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Task type',
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
      const body: any = { note: params.note }
      if (params.contact_id) body.contact_id = params.contact_id
      if (params.account_id) body.account_id = params.account_id
      if (params.due_at) body.due_at = params.due_at
      if (params.priority) body.priority = params.priority
      if (params.type) body.type = params.type
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Apollo API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()

    // Apollo's task creation endpoint currently only returns true, not the task object
    // Return the request params as the task data since the API doesn't return it
    return {
      success: true,
      output: {
        task: data.task ?? null,
        created: data === true || !!data.task,
      },
    }
  },

  outputs: {
    task: { type: 'json', description: 'Created task data from Apollo', optional: true },
    created: { type: 'boolean', description: 'Whether the task was successfully created' },
  },
}
