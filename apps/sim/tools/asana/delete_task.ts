import type { AsanaDeleteTaskParams, AsanaDeleteTaskResponse } from '@/tools/asana/types'
import type { ToolConfig } from '@/tools/types'

export const asanaDeleteTaskTool: ToolConfig<AsanaDeleteTaskParams, AsanaDeleteTaskResponse> = {
  id: 'asana_delete_task',
  name: 'Asana Delete Task',
  description: 'Delete an Asana task by its GID (moves it to the trash)',
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
      description: 'GID of the Asana task to delete (numeric string)',
    },
  },

  request: {
    url: '/api/tools/asana/delete-task',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessToken: params.accessToken,
      taskGid: params.taskGid,
    }),
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()

    if (!responseText) {
      return {
        success: false,
        output: { ts: new Date().toISOString(), gid: '', deleted: true },
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
    gid: { type: 'string', description: 'GID of the deleted task' },
    deleted: { type: 'boolean', description: 'Whether the task was deleted' },
  },
}
