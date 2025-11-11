import type { AsanaCreateTaskParams, AsanaCreateTaskResponse } from '@/tools/asana/types'
import type { ToolConfig } from '@/tools/types'

export const asanaCreateTaskTool: ToolConfig<AsanaCreateTaskParams, AsanaCreateTaskResponse> = {
  id: 'asana_create_task',
  name: 'Asana Create Task',
  description: 'Create a new task in Asana',
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
    workspace: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Workspace GID where the task will be created',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the task',
    },
    notes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Notes or description for the task',
    },
    assignee: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User GID to assign the task to',
    },
    due_on: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Due date in YYYY-MM-DD format',
    },
  },

  request: {
    url: '/api/tools/asana/create-task',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessToken: params.accessToken,
      workspace: params.workspace,
      name: params.name,
      notes: params.notes,
      assignee: params.assignee,
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
          name: 'Task created successfully',
          notes: '',
          completed: false,
          created_at: new Date().toISOString(),
          permalink_url: '',
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
        name: 'Task creation failed',
        notes: '',
        completed: false,
        created_at: new Date().toISOString(),
        permalink_url: '',
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
      description: 'Created task details with timestamp, gid, name, notes, and permalink',
    },
  },
}
