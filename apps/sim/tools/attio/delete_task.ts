import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioDeleteTaskParams, AttioDeleteTaskResponse } from './types'

const logger = createLogger('AttioDeleteTask')

export const attioDeleteTaskTool: ToolConfig<AttioDeleteTaskParams, AttioDeleteTaskResponse> = {
  id: 'attio_delete_task',
  name: 'Attio Delete Task',
  description: 'Delete a task from Attio',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'attio',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The OAuth access token for the Attio API',
    },
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the task to delete',
    },
  },

  request: {
    url: (params) => `https://api.attio.com/v2/tasks/${params.taskId}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const data = await response.json()
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to delete task')
    }
    return {
      success: true,
      output: {
        deleted: true,
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the task was deleted' },
  },
}
