import type { A2ACancelTaskParams, A2ACancelTaskResponse } from '@/tools/a2a/types'
import type { ToolConfig } from '@/tools/types'

export const a2aCancelTaskTool: ToolConfig<A2ACancelTaskParams, A2ACancelTaskResponse> = {
  id: 'a2a_cancel_task',
  name: 'A2A Cancel Task',
  description: 'Request cancellation of an in-progress A2A task.',
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
      description: 'The task ID to cancel',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'API key for authentication (if required)',
    },
  },

  request: {
    url: '/api/tools/a2a/cancel-task',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const body: Record<string, unknown> = {
        agentUrl: params.agentUrl,
        taskId: params.taskId,
      }
      if (params.apiKey) body.apiKey = params.apiKey
      return body
    },
  },

  transformResponse: async (response: Response) => response.json(),

  outputs: {
    taskId: { type: 'string', description: 'Task identifier' },
    state: { type: 'string', description: 'Task lifecycle state after cancellation' },
    canceled: { type: 'boolean', description: 'Whether the task was canceled' },
  },
}
