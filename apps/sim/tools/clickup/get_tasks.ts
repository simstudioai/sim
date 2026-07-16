import {
  CLICKUP_API_BASE_URL,
  CLICKUP_TASK_OUTPUT_PROPERTIES,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
  mapClickUpTask,
} from '@/tools/clickup/shared'
import type { ClickUpGetTasksParams, ClickUpTaskListResponse } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupGetTasksTool: ToolConfig<ClickUpGetTasksParams, ClickUpTaskListResponse> = {
  id: 'clickup_get_tasks',
  name: 'ClickUp Get Tasks',
  description:
    'List the tasks in a ClickUp list (100 tasks per page; increment page until an empty result to paginate)',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'clickup',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token or personal API token for ClickUp',
    },
    listId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the list to fetch tasks from',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page to fetch (starts at 0)',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order by field: id, created, updated, or due_date',
    },
    reverse: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return tasks in reverse order',
    },
    subtasks: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include subtasks (excluded by default)',
    },
    includeClosed: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include closed tasks (excluded by default)',
    },
    archived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return archived tasks',
    },
    statuses: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter tasks by status names',
      items: {
        type: 'string',
        description: 'A status name',
      },
    },
    assignees: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter tasks by assignee user IDs',
      items: {
        type: 'string',
        description: 'A ClickUp user ID',
      },
    },
    tags: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter tasks by tag names',
      items: {
        type: 'string',
        description: 'A tag name',
      },
    },
    dueDateGt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only tasks due after this Unix timestamp in milliseconds',
    },
    dueDateLt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only tasks due before this Unix timestamp in milliseconds',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${CLICKUP_API_BASE_URL}/list/${encodeURIComponent(params.listId)}/task`)
      if (params.page !== undefined) url.searchParams.set('page', String(params.page))
      if (params.orderBy) url.searchParams.set('order_by', params.orderBy)
      if (params.reverse !== undefined) url.searchParams.set('reverse', String(params.reverse))
      if (params.subtasks !== undefined) url.searchParams.set('subtasks', String(params.subtasks))
      if (params.includeClosed !== undefined) {
        url.searchParams.set('include_closed', String(params.includeClosed))
      }
      if (params.archived !== undefined) url.searchParams.set('archived', String(params.archived))
      for (const status of params.statuses ?? []) {
        url.searchParams.append('statuses[]', status)
      }
      for (const assignee of params.assignees ?? []) {
        url.searchParams.append('assignees[]', assignee)
      }
      for (const tag of params.tags ?? []) {
        url.searchParams.append('tags[]', tag)
      }
      if (params.dueDateGt !== undefined) {
        url.searchParams.set('due_date_gt', String(params.dueDateGt))
      }
      if (params.dueDateLt !== undefined) {
        url.searchParams.set('due_date_lt', String(params.dueDateLt))
      }
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractClickUpErrorMessage(response, data, 'Failed to get tasks')
      return { success: false, output: { error }, error }
    }

    const rawTasks = Array.isArray(data?.tasks) ? data.tasks : []

    return {
      success: true,
      output: { tasks: rawTasks.map((task: unknown) => mapClickUpTask(task)) },
    }
  },

  outputs: {
    tasks: {
      type: 'array',
      description: 'Tasks in the list',
      optional: true,
      items: {
        type: 'object',
        properties: CLICKUP_TASK_OUTPUT_PROPERTIES,
      },
    },
  },
}
