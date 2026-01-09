/**
 * A2A Cancel Task Tool
 *
 * Cancel a running A2A task.
 */

import { createLogger } from '@sim/logger'
import { A2A_METHODS } from '@/lib/a2a/constants'
import type { Task } from '@/lib/a2a/types'
import type { ToolConfig } from '@/tools/types'
import type { A2ACancelTaskParams, A2ACancelTaskResponse } from './types'

const logger = createLogger('A2ACancelTaskTool')

export const a2aCancelTaskTool: ToolConfig<A2ACancelTaskParams, A2ACancelTaskResponse> = {
  id: 'a2a_cancel_task',
  name: 'A2A Cancel Task',
  description: 'Cancel a running A2A task.',
  version: '1.0.0',

  params: {
    agentUrl: {
      type: 'string',
      required: true,
      description: 'The A2A agent endpoint URL',
    },
    taskId: {
      type: 'string',
      required: true,
      description: 'Task ID to cancel',
    },
    apiKey: {
      type: 'string',
      description: 'API key for authentication',
    },
  },

  request: {
    url: (params: A2ACancelTaskParams) => params.agentUrl,
    method: 'POST',
    headers: (params: A2ACancelTaskParams) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (params.apiKey) {
        headers.Authorization = `Bearer ${params.apiKey}`
      }
      return headers
    },
    body: (params: A2ACancelTaskParams) => ({
      jsonrpc: '2.0',
      id: Date.now().toString(),
      method: A2A_METHODS.TASKS_CANCEL,
      params: {
        id: params.taskId,
      },
    }),
  },

  transformResponse: async (response: Response) => {
    try {
      const result = await response.json()

      if (result.error) {
        return {
          success: false,
          output: {
            cancelled: false,
            state: 'failed',
          },
          error: result.error.message || 'A2A request failed',
        }
      }

      const task = result.result as Task

      return {
        success: true,
        output: {
          cancelled: true,
          state: task.status.state,
        },
      }
    } catch (error) {
      logger.error('Error parsing A2A response:', error)
      return {
        success: false,
        output: {
          cancelled: false,
          state: 'failed',
        },
        error: error instanceof Error ? error.message : 'Failed to parse response',
      }
    }
  },

  outputs: {
    cancelled: {
      type: 'boolean',
      description: 'Whether cancellation was successful',
    },
    state: {
      type: 'string',
      description: 'Task state after cancellation',
    },
  },
}
