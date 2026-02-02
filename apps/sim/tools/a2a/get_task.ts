import type { A2AGetTaskParams, A2AGetTaskResponse } from '@/tools/a2a/types'
import { A2A_OUTPUT_PROPERTIES } from '@/tools/a2a/types'
import type { ToolConfig } from '@/tools/types'

export const a2aGetTaskTool: ToolConfig<A2AGetTaskParams, A2AGetTaskResponse> = {
  id: 'a2a_get_task',
  name: 'A2A Get Task',
  description: 'Query the status of an existing A2A task.',
  version: '1.0.0',

  params: {
    agentUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The A2A agent endpoint URL',
    },
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Task ID to query',
    },
    apiKey: {
      type: 'string',
      visibility: 'user-only',
      description: 'API key for authentication',
    },
    historyLength: {
      type: 'number',
      visibility: 'user-or-llm',
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
    taskId: A2A_OUTPUT_PROPERTIES.taskId,
    contextId: A2A_OUTPUT_PROPERTIES.contextId,
    state: A2A_OUTPUT_PROPERTIES.state,
    artifacts: A2A_OUTPUT_PROPERTIES.artifacts,
    history: A2A_OUTPUT_PROPERTIES.history,
  },
}
