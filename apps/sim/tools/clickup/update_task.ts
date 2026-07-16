import {
  CLICKUP_API_BASE_URL,
  CLICKUP_TASK_OUTPUT_PROPERTIES,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
  mapClickUpTask,
} from '@/tools/clickup/shared'
import type { ClickUpTaskResponse, ClickUpUpdateTaskParams } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupUpdateTaskTool: ToolConfig<ClickUpUpdateTaskParams, ClickUpTaskResponse> = {
  id: 'clickup_update_task',
  name: 'ClickUp Update Task',
  description: 'Update an existing task in ClickUp',
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
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the task to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name for the task',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New plain text description (use a single space to clear)',
    },
    markdownContent: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New Markdown description (takes precedence over description)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New status for the task (must exist in the list)',
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
      description: 'New due date as a Unix timestamp in milliseconds',
    },
    startDate: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'New start date as a Unix timestamp in milliseconds',
    },
    timeEstimate: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'New time estimate in milliseconds',
    },
    points: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'New sprint points value',
    },
    parent: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Parent task ID to move this task under (cannot be cleared)',
    },
    archived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to true to archive the task, false to unarchive',
    },
  },

  request: {
    url: (params) => `${CLICKUP_API_BASE_URL}/task/${encodeURIComponent(params.taskId)}`,
    method: 'PUT',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.name !== undefined) body.name = params.name
      if (params.description !== undefined) body.description = params.description
      if (params.markdownContent !== undefined) body.markdown_content = params.markdownContent
      if (params.status !== undefined) body.status = params.status
      if (params.priority !== undefined) body.priority = params.priority
      if (params.dueDate !== undefined) body.due_date = params.dueDate
      if (params.startDate !== undefined) body.start_date = params.startDate
      if (params.timeEstimate !== undefined) body.time_estimate = params.timeEstimate
      if (params.points !== undefined) body.points = params.points
      if (params.parent !== undefined) body.parent = params.parent
      if (params.archived !== undefined) body.archived = params.archived

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractClickUpErrorMessage(response, data, 'Failed to update task')
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
      description: 'The updated task',
      optional: true,
      properties: CLICKUP_TASK_OUTPUT_PROPERTIES,
    },
  },
}
