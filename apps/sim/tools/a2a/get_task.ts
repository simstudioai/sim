/**
 * A2A Get Task Tool
 *
 * Query the status of an existing A2A task.
 */

import { createLogger } from '@sim/logger'
import { A2A_METHODS } from '@/lib/a2a/constants'
import type { Task } from '@/lib/a2a/types'
import type { ToolConfig } from '@/tools/types'
import type { A2AGetTaskParams, A2AGetTaskResponse } from './types'

const logger = createLogger('A2AGetTaskTool')

export const a2aGetTaskTool: ToolConfig<A2AGetTaskParams, A2AGetTaskResponse> = {
  id: 'a2a_get_task',
  name: 'A2A Get Task',
  description: 'Query the status of an existing A2A task.',
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
      description: 'Task ID to query',
    },
    apiKey: {
      type: 'string',
      description: 'API key for authentication',
    },
    historyLength: {
      type: 'number',
      description: 'Number of history messages to include',
    },
  },

  request: {
    url: (params: A2AGetTaskParams) => params.agentUrl,
    method: 'POST',
    headers: (params: A2AGetTaskParams) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (params.apiKey) {
        headers.Authorization = `Bearer ${params.apiKey}`
      }
      return headers
    },
    body: (params: A2AGetTaskParams) => ({
      jsonrpc: '2.0',
      id: Date.now().toString(),
      method: A2A_METHODS.TASKS_GET,
      params: {
        id: params.taskId,
        historyLength: params.historyLength,
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
            taskId: '',
            state: 'failed',
          },
          error: result.error.message || 'A2A request failed',
        }
      }

      const task = result.result as Task

      return {
        success: true,
        output: {
          taskId: task.id,
          contextId: task.contextId,
          state: task.status.state,
          artifacts: task.artifacts,
          history: task.history,
        },
      }
    } catch (error) {
      logger.error('Error parsing A2A response:', error)
      return {
        success: false,
        output: {
          taskId: '',
          state: 'failed',
        },
        error: error instanceof Error ? error.message : 'Failed to parse response',
      }
    }
  },

  outputs: {
    taskId: {
      type: 'string',
      description: 'Task ID',
    },
    contextId: {
      type: 'string',
      description: 'Context ID',
    },
    state: {
      type: 'string',
      description: 'Task state',
    },
    artifacts: {
      type: 'array',
      description: 'Output artifacts',
    },
    history: {
      type: 'array',
      description: 'Message history',
    },
  },
}
