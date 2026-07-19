import type { AsanaCreateSubtaskParams, AsanaCreateTaskResponse } from '@/tools/asana/types'
import type { ToolConfig } from '@/tools/types'

export const asanaCreateSubtaskTool: ToolConfig<AsanaCreateSubtaskParams, AsanaCreateTaskResponse> =
  {
    id: 'asana_create_subtask',
    name: 'Asana Create Subtask',
    description: 'Create a subtask under an existing Asana task',
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
        visibility: 'user-or-llm',
        description: 'GID of the parent Asana task (numeric string)',
      },
      name: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Name of the subtask',
      },
      notes: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Notes or description for the subtask',
      },
      assignee: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'User GID to assign the subtask to',
      },
      due_on: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Due date in YYYY-MM-DD format',
      },
    },

    request: {
      url: '/api/tools/asana/create-subtask',
      method: 'POST',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      body: (params) => ({
        accessToken: params.accessToken,
        taskGid: params.taskGid,
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
          success: false,
          output: {
            ts: new Date().toISOString(),
            gid: '',
            name: '',
            notes: '',
            completed: false,
            created_at: new Date().toISOString(),
            permalink_url: '',
          },
          error: 'Empty response from Asana',
        }
      }

      const data = JSON.parse(responseText)
      const { success, error, ...output } = data
      return {
        success: success ?? true,
        output,
        error,
      }
    },

    outputs: {
      success: { type: 'boolean', description: 'Operation success status' },
      ts: { type: 'string', description: 'Timestamp of the response' },
      gid: { type: 'string', description: 'Subtask globally unique identifier' },
      name: { type: 'string', description: 'Subtask name' },
      notes: { type: 'string', description: 'Subtask notes or description' },
      completed: { type: 'boolean', description: 'Whether the subtask is completed' },
      created_at: { type: 'string', description: 'Subtask creation timestamp' },
      permalink_url: { type: 'string', description: 'URL to the subtask in Asana' },
    },
  }
