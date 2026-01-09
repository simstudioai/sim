/**
 * A2A Send Task Tool
 *
 * Send a task to an external A2A-compatible agent.
 */

import { createLogger } from '@sim/logger'
import { A2A_METHODS } from '@/lib/a2a/constants'
import type { Task, TaskMessage } from '@/lib/a2a/types'
import { extractTextContent } from '@/lib/a2a/utils'
import type { ToolConfig } from '@/tools/types'
import type { A2ASendTaskParams, A2ASendTaskResponse } from './types'

const logger = createLogger('A2ASendTaskTool')

export const a2aSendTaskTool: ToolConfig<A2ASendTaskParams, A2ASendTaskResponse> = {
  id: 'a2a_send_task',
  name: 'A2A Send Task',
  description: 'Send a message to an external A2A-compatible agent.',
  version: '1.0.0',

  params: {
    agentUrl: {
      type: 'string',
      required: true,
      description: 'The A2A agent endpoint URL',
    },
    message: {
      type: 'string',
      required: true,
      description: 'Message to send to the agent',
    },
    taskId: {
      type: 'string',
      description: 'Task ID for continuing an existing conversation',
    },
    contextId: {
      type: 'string',
      description: 'Context ID for conversation continuity',
    },
    apiKey: {
      type: 'string',
      description: 'API key for authentication',
    },
  },

  request: {
    url: (params: A2ASendTaskParams) => params.agentUrl,
    method: 'POST',
    headers: (params: A2ASendTaskParams) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (params.apiKey) {
        headers.Authorization = `Bearer ${params.apiKey}`
      }
      return headers
    },
    body: (params: A2ASendTaskParams) => {
      const userMessage: TaskMessage = {
        role: 'user',
        parts: [{ type: 'text', text: params.message }],
      }

      return {
        jsonrpc: '2.0',
        id: Date.now().toString(),
        method: A2A_METHODS.TASKS_SEND,
        params: {
          id: params.taskId,
          contextId: params.contextId,
          message: userMessage,
        },
      }
    },
  },

  transformResponse: async (response: Response) => {
    try {
      const result = await response.json()

      if (result.error) {
        return {
          success: false,
          output: {
            content: result.error.message || 'A2A request failed',
            taskId: '',
            state: 'failed',
          },
          error: result.error.message || 'A2A request failed',
        }
      }

      const task = result.result as Task

      // Extract content from the last agent message
      const lastAgentMessage = task.history?.filter((m) => m.role === 'agent').pop()

      const content = lastAgentMessage ? extractTextContent(lastAgentMessage) : ''

      return {
        success: true,
        output: {
          content,
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
          content: error instanceof Error ? error.message : 'Failed to parse response',
          taskId: '',
          state: 'failed',
        },
        error: error instanceof Error ? error.message : 'Failed to parse response',
      }
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'The text response from the agent',
    },
    taskId: {
      type: 'string',
      description: 'Task ID for follow-up interactions',
    },
    contextId: {
      type: 'string',
      description: 'Context ID for conversation continuity',
    },
    state: {
      type: 'string',
      description: 'Task state',
    },
    artifacts: {
      type: 'array',
      description: 'Structured output artifacts',
    },
    history: {
      type: 'array',
      description: 'Full message history',
    },
  },
}
