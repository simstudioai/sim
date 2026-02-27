import type {
  GoogleTasksListTaskListsParams,
  GoogleTasksListTaskListsResponse,
} from '@/tools/google_tasks/types'
import { TASKS_API_BASE } from '@/tools/google_tasks/types'
import type { ToolConfig } from '@/tools/types'

export const listTaskListsTool: ToolConfig<
  GoogleTasksListTaskListsParams,
  GoogleTasksListTaskListsResponse
> = {
  id: 'google_tasks_list_task_lists',
  name: 'Google Tasks List Task Lists',
  description: 'Retrieve all task lists for the authenticated user',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-tasks',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Google Tasks OAuth access token',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of task lists to return (default 20, max 100)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Token for pagination',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.maxResults) queryParams.set('maxResults', String(params.maxResults))
      if (params.pageToken) queryParams.set('pageToken', params.pageToken)
      const qs = queryParams.toString()
      return `${TASKS_API_BASE}/users/@me/lists${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message ?? 'Failed to list task lists')
    }

    const items = data.items ?? []

    return {
      success: true,
      output: {
        taskLists: items.map((item: Record<string, unknown>) => ({
          id: (item.id as string) ?? null,
          title: (item.title as string) ?? null,
          updated: (item.updated as string) ?? null,
          selfLink: (item.selfLink as string) ?? null,
        })),
        nextPageToken: data.nextPageToken ?? null,
      },
    }
  },

  outputs: {
    taskLists: {
      type: 'array',
      description: 'List of task lists',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task list identifier' },
          title: { type: 'string', description: 'Title of the task list' },
          updated: {
            type: 'string',
            description: 'Last modification time (RFC 3339 timestamp)',
          },
          selfLink: { type: 'string', description: 'URL pointing to this task list' },
        },
      },
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for retrieving the next page of results',
      optional: true,
    },
  },
}
