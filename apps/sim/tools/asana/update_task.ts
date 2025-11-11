import type { AsanaUpdateTaskParams, AsanaUpdateTaskResponse } from '@/tools/asana/types'
import type { ToolConfig } from '@/tools/types'

export const asanaUpdateTaskTool: ToolConfig<AsanaUpdateTaskParams, AsanaUpdateTaskResponse> = {
  id: 'asana_update_task',
  name: 'Asana Update Task',
  description: 'Update an existing task in Asana',
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
      required: true,
      visibility: 'user-only',
      description: 'The globally unique identifier (GID) of the task to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated name for the task',
    },
    notes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated notes or description for the task',
    },
    assignee: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated assignee user GID',
    },
    completed: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Mark task as completed or not completed',
    },
    due_on: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated due date in YYYY-MM-DD format',
    },
  },

  request: {
    url: '/api/tools/asana/update-task',
    method: 'PUT',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessToken: params.accessToken,
      taskGid: params.taskGid,
      name: params.name,
      notes: params.notes,
      assignee: params.assignee,
      completed: params.completed,
      due_on: params.due_on,
    }),
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()

    if (!responseText) {
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          gid: 'unknown',
          name: 'Task updated successfully',
          notes: '',
          completed: false,
          modified_at: new Date().toISOString(),
        },
      }
    }

    const data = JSON.parse(responseText)

    if (data.success && data.output) {
      return data
    }

    return {
      success: data.success || false,
      output: data.output || {
        ts: new Date().toISOString(),
        gid: 'unknown',
        name: 'Task update failed',
        notes: '',
        completed: false,
        modified_at: new Date().toISOString(),
      },
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
      description: 'Updated task details with timestamp, gid, name, notes, and modified timestamp',
    },
  },
}
