import type { ToolConfig } from '@/tools/types'
import type { A2AGetTaskParams, A2AGetTaskResponse } from './types'

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
    url: '/api/tools/a2a/get-task',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: A2AGetTaskParams) => {
      const body: Record<string, string | number> = {
        agentUrl: params.agentUrl,
        taskId: params.taskId,
      }
      if (params.apiKey) body.apiKey = params.apiKey
      if (params.historyLength) body.historyLength = params.historyLength
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return data
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
