import type { AsanaGetTaskParams, AsanaGetTaskResponse } from '@/tools/asana/types'
import type { ToolConfig } from '@/tools/types'

export const asanaGetTaskTool: ToolConfig<AsanaGetTaskParams, AsanaGetTaskResponse> = {
  id: 'asana_get_task',
  name: 'Asana Get Task',
  description: 'Retrieve a single task by GID or get multiple tasks with filters',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'asana',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Asana',
    },
    taskGid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The globally unique identifier (GID) of the task. If not provided, will get multiple tasks.',
    },
    workspace: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Workspace GID to filter tasks (required when not using taskGid)',
    },
    project: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Project GID to filter tasks',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of tasks to return (default: 50)',
    },
  },

  request: {
    url: '/api/tools/asana/get-task',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessToken: params.accessToken,
      taskGid: params.taskGid,
      workspace: params.workspace,
      project: params.project,
      limit: params.limit,
    }),
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()

    if (!responseText) {
      return {
        success: false,
        error: 'Empty response from Asana',
      }
    }

    const data = JSON.parse(responseText)

    if (data.success && data.output) {
      return data
    }

    return {
      success: data.success || false,
      output: data.output || null,
      error: data.error,
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Operation success status',
    },
    output: {
      type: 'object',
      description:
        'Single task details or array of tasks, depending on whether taskGid was provided',
    },
  },
}
