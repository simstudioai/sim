import type { A2ASendMessageParams, A2ASendMessageResponse } from '@/tools/a2a/types'
import { A2A_OUTPUT_PROPERTIES } from '@/tools/a2a/types'
import type { ToolConfig } from '@/tools/types'

export const a2aSendMessageTool: ToolConfig<A2ASendMessageParams, A2ASendMessageResponse> = {
  id: 'a2a_send_message',
  name: 'A2A Send Message',
  description: 'Send a message to an external A2A-compatible agent.',
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
      description: 'Message to send to the agent',
    },
    taskId: {
      type: 'string',
      visibility: 'user-or-llm',
      description: 'Task ID for continuing an existing task',
    },
    contextId: {
      type: 'string',
      visibility: 'user-or-llm',
      description: 'Context ID for conversation continuity',
    },
    data: {
      type: 'string',
      visibility: 'user-or-llm',
      description: 'Structured data to include with the message (JSON string)',
    },
    files: {
      type: 'array',
      visibility: 'user-only',
      description: 'Files to include with the message',
    },
    apiKey: {
      type: 'string',
      visibility: 'user-only',
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
    content: A2A_OUTPUT_PROPERTIES.content,
    taskId: A2A_OUTPUT_PROPERTIES.taskId,
    contextId: A2A_OUTPUT_PROPERTIES.contextId,
    state: A2A_OUTPUT_PROPERTIES.state,
    artifacts: A2A_OUTPUT_PROPERTIES.artifacts,
    history: A2A_OUTPUT_PROPERTIES.history,
  },
}
