import {
  CLICKUP_API_BASE_URL,
  CLICKUP_TASK_OUTPUT_PROPERTIES,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
  mapClickUpTask,
} from '@/tools/clickup/shared'
import type { ClickUpGetTaskParams, ClickUpTaskResponse } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupGetTaskTool: ToolConfig<ClickUpGetTaskParams, ClickUpTaskResponse> = {
  id: 'clickup_get_task',
  name: 'ClickUp Get Task',
  description: 'Retrieve a task from ClickUp by ID',
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
      description: 'ID of the task to retrieve',
    },
    includeSubtasks: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include subtasks in the response',
    },
    includeMarkdownDescription: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return the task description in Markdown format',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${CLICKUP_API_BASE_URL}/task/${encodeURIComponent(params.taskId)}`)
      if (params.includeSubtasks !== undefined) {
        url.searchParams.set('include_subtasks', String(params.includeSubtasks))
      }
      if (params.includeMarkdownDescription !== undefined) {
        url.searchParams.set(
          'include_markdown_description',
          String(params.includeMarkdownDescription)
        )
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
      const error = extractClickUpErrorMessage(response, data, 'Failed to get task')
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
      description: 'The requested task',
      optional: true,
      properties: CLICKUP_TASK_OUTPUT_PROPERTIES,
    },
  },
}
