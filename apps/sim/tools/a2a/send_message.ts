import {
  A2A_TASK_OUTPUTS,
  type A2ASendMessageParams,
  type A2ATaskResponse,
} from '@/tools/a2a/types'
import type { ToolConfig } from '@/tools/types'

export const a2aSendMessageTool: ToolConfig<A2ASendMessageParams, A2ATaskResponse> = {
  id: 'a2a_send_message',
  name: 'A2A Send Message',
  description: 'Send a message to an external A2A agent and return its response.',
  version: '1.0.0',

  params: {
    agentUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The A2A agent endpoint URL',
    },
    message: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The message text to send',
    },
    data: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional structured JSON data to attach',
    },
    files: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional files to attach',
    },
    taskId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Existing task ID to continue',
    },
    contextId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Conversation context ID to continue',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'API key for authentication (if required)',
    },
  },

  request: {
    url: '/api/tools/a2a/send-message',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const body: Record<string, unknown> = {
        agentUrl: params.agentUrl,
        message: params.message,
      }
      if (params.data) body.data = params.data
      if (params.files) body.files = params.files
      if (params.taskId) body.taskId = params.taskId
      if (params.contextId) body.contextId = params.contextId
      if (params.apiKey) body.apiKey = params.apiKey
      return body
    },
  },

  transformResponse: async (response: Response) => response.json(),

  outputs: A2A_TASK_OUTPUTS,
}
