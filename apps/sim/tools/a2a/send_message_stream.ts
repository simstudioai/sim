import type { ToolConfig } from '@/tools/types'
import type { A2ASendMessageParams, A2ASendMessageResponse } from './types'

export const a2aSendMessageStreamTool: ToolConfig<A2ASendMessageParams, A2ASendMessageResponse> = {
  id: 'a2a_send_message_stream',
  name: 'A2A Send Message (Streaming)',
  description: 'Send a message to an external A2A-compatible agent with real-time streaming.',
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
    apiKey: {
      type: 'string',
      description: 'API key for authentication',
    },
  },

  request: {
    url: '/api/tools/a2a/send-message-stream',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      agentUrl: params.agentUrl,
      message: params.message,
      taskId: params.taskId,
      contextId: params.contextId,
      apiKey: params.apiKey,
    }),
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
