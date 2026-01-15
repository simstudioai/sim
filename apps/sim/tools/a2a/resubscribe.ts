import type { ToolConfig } from '@/tools/types'
import type { A2AResubscribeParams, A2AResubscribeResponse } from './types'

export const a2aResubscribeTool: ToolConfig<A2AResubscribeParams, A2AResubscribeResponse> = {
  id: 'a2a_resubscribe',
  name: 'A2A Resubscribe',
  description: 'Reconnect to an ongoing A2A task stream after connection interruption.',
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
      description: 'Task ID to resubscribe to',
    },
    apiKey: {
      type: 'string',
      description: 'API key for authentication',
    },
  },

  request: {
    url: '/api/tools/a2a/resubscribe',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: A2AResubscribeParams) => {
      const body: Record<string, string> = {
        agentUrl: params.agentUrl,
        taskId: params.taskId,
      }
      if (params.apiKey) body.apiKey = params.apiKey
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          taskId: '',
          state: 'failed' as const,
          isRunning: false,
        },
        error: data.error || 'Failed to resubscribe',
      }
    }

    return {
      success: true,
      output: data.output,
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
      description: 'Current task state',
    },
    isRunning: {
      type: 'boolean',
      description: 'Whether the task is still running',
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
