import {
  CLICKUP_API_BASE_URL,
  CLICKUP_TASK_OUTPUT_PROPERTIES,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
  mapClickUpTask,
} from '@/tools/clickup/shared'
import type { ClickUpCreateTaskParams, ClickUpTaskResponse } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupCreateTaskTool: ToolConfig<ClickUpCreateTaskParams, ClickUpTaskResponse> = {
  id: 'clickup_create_task',
  name: 'ClickUp Create Task',
  description: 'Create a new task in a ClickUp list',
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
      description: 'ID of the list to create the task in',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the task',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Plain text description of the task',
    },
    markdownContent: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Markdown description of the task (overrides description)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Status to create the task with (must exist in the list)',
    },
    priority: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Priority: 1 (urgent), 2 (high), 3 (normal), 4 (low)',
    },
    dueDate: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Due date as a Unix timestamp in milliseconds',
    },
    startDate: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date as a Unix timestamp in milliseconds',
    },
    assignees: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'User IDs to assign to the task',
      items: {
        type: 'number',
        description: 'A ClickUp user ID',
      },
    },
    tags: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tag names to apply to the task',
      items: {
        type: 'string',
        description: 'A tag name',
      },
    },
    timeEstimate: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Time estimate in milliseconds',
    },
    parent: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Parent task ID to create this task as a subtask',
    },
    notifyAll: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to notify the task creator on creation',
    },
  },

  request: {
    url: (params) => `${CLICKUP_API_BASE_URL}/list/${encodeURIComponent(params.listId)}/task`,
    method: 'POST',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        name: params.name,
      }

      if (params.description) body.description = params.description
      if (params.markdownContent) body.markdown_content = params.markdownContent
      if (params.status) body.status = params.status
      if (params.priority !== undefined) body.priority = params.priority
      if (params.dueDate !== undefined) body.due_date = params.dueDate
      if (params.startDate !== undefined) body.start_date = params.startDate
      if (params.assignees?.length) body.assignees = params.assignees
      if (params.tags?.length) body.tags = params.tags
      if (params.timeEstimate !== undefined) body.time_estimate = params.timeEstimate
      if (params.parent) body.parent = params.parent
      if (params.notifyAll !== undefined) body.notify_all = params.notifyAll

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractClickUpErrorMessage(response, data, 'Failed to create task')
      return { success: false, output: { error }, error }
    }

    return {
      success: true,
      output: { task: mapClickUpTask(data) },
    }
  },

  outputs: {
    task: {
      type: 'json',
      description: 'The created task',
      optional: true,
      properties: CLICKUP_TASK_OUTPUT_PROPERTIES,
    },
  },
}
