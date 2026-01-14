import type { ToolConfig } from '@/tools/types'
import type { A2ACancelTaskParams, A2ACancelTaskResponse } from './types'

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
    url: '/api/tools/a2a/cancel-task',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: A2ACancelTaskParams) => {
      const body: Record<string, string> = {
        agentUrl: params.agentUrl,
        taskId: params.taskId,
      }
      if (params.apiKey) body.apiKey = params.apiKey
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return data
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
