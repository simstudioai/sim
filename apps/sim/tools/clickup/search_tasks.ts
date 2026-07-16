import {
  CLICKUP_API_BASE_URL,
  CLICKUP_TASK_OUTPUT_PROPERTIES,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
  mapClickUpTask,
} from '@/tools/clickup/shared'
import type { ClickUpSearchTasksParams, ClickUpTaskListResponse } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupSearchTasksTool: ToolConfig<ClickUpSearchTasksParams, ClickUpTaskListResponse> =
  {
    id: 'clickup_search_tasks',
    name: 'ClickUp Search Tasks',
    description:
      'Search tasks across a ClickUp workspace, filtered by lists, folders, or spaces (100 tasks per page)',
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
      workspaceId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the workspace (team) to search tasks in',
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
      listIds: {
        type: 'array',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by list IDs',
        items: {
          type: 'string',
          description: 'A ClickUp list ID',
        },
      },
      spaceIds: {
        type: 'array',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by space IDs',
        items: {
          type: 'string',
          description: 'A ClickUp space ID',
        },
      },
      folderIds: {
        type: 'array',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by folder IDs',
        items: {
          type: 'string',
          description: 'A ClickUp folder ID',
        },
      },
    },

    request: {
      url: (params) => {
        const url = new URL(
          `${CLICKUP_API_BASE_URL}/team/${encodeURIComponent(params.workspaceId)}/task`
        )
        if (params.page !== undefined) url.searchParams.set('page', String(params.page))
        if (params.orderBy) url.searchParams.set('order_by', params.orderBy)
        if (params.reverse !== undefined) url.searchParams.set('reverse', String(params.reverse))
        if (params.subtasks !== undefined) {
          url.searchParams.set('subtasks', String(params.subtasks))
        }
        for (const listId of params.listIds ?? []) {
          url.searchParams.append('list_ids[]', listId)
        }
        for (const spaceId of params.spaceIds ?? []) {
          url.searchParams.append('space_ids[]', spaceId)
        }
        for (const folderId of params.folderIds ?? []) {
          url.searchParams.append('project_ids[]', folderId)
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
        const error = extractClickUpErrorMessage(response, data, 'Failed to search tasks')
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
        description: 'Tasks matching the filters',
        optional: true,
        items: {
          type: 'object',
          properties: CLICKUP_TASK_OUTPUT_PROPERTIES,
        },
      },
    },
  }
