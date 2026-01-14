import type { ToolConfig } from '@/tools/types'
import type { A2ASendMessageParams, A2ASendMessageResponse } from './types'

export const a2aSendMessageTool: ToolConfig<A2ASendMessageParams, A2ASendMessageResponse> = {
  id: 'a2a_send_message',
  name: 'A2A Send Message',
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
      description: 'Task ID for continuing an existing task',
    },
    contextId: {
      type: 'string',
      description: 'Context ID for conversation continuity',
    },
    data: {
      type: 'string',
      description: 'Structured data to include with the message (JSON string)',
    },
    files: {
      type: 'array',
      description: 'Files to include with the message',
    },
    apiKey: {
      type: 'string',
      description: 'API key for authentication',
    },
  },

  request: {
    url: '/api/tools/a2a/send-message',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        agentUrl: params.agentUrl,
        message: params.message,
      }
      if (params.taskId) body.taskId = params.taskId
      if (params.contextId) body.contextId = params.contextId
      if (params.data) body.data = params.data
      if (params.files && params.files.length > 0) body.files = params.files
      if (params.apiKey) body.apiKey = params.apiKey
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return data
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
