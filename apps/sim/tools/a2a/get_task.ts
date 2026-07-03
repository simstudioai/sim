import { A2A_TASK_OUTPUTS, type A2AGetTaskParams, type A2ATaskResponse } from '@/tools/a2a/types'
import type { ToolConfig } from '@/tools/types'

export const a2aGetTaskTool: ToolConfig<A2AGetTaskParams, A2ATaskResponse> = {
  id: 'a2a_get_task',
  name: 'A2A Get Task',
  description: 'Retrieve the current state and result of an A2A task.',
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
      description: 'The task ID to retrieve',
    },
    historyLength: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of history messages to include',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'API key for authentication (if required)',
    },
  },

  request: {
    url: '/api/tools/a2a/get-task',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const body: Record<string, unknown> = {
        agentUrl: params.agentUrl,
        taskId: params.taskId,
      }
      if (params.historyLength !== undefined) body.historyLength = params.historyLength
      if (params.apiKey) body.apiKey = params.apiKey
      return body
    },
  },

  transformResponse: async (response: Response) => response.json(),

  outputs: A2A_TASK_OUTPUTS,
}
