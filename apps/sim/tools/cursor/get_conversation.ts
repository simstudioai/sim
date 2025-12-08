import type { GetConversationParams, GetConversationResponse } from '@/tools/cursor/types'
import type { ToolConfig } from '@/tools/types'

export const getConversationTool: ToolConfig<GetConversationParams, GetConversationResponse> = {
  id: 'cursor_get_conversation',
  name: 'Cursor Get Conversation',
  description:
    'Retrieve the conversation history of a cloud agent, including all user prompts and assistant responses.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cursor API key',
    },
    agentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique identifier for the cloud agent (e.g., bc_abc123)',
    },
  },

  request: {
    url: (params) => `https://api.cursor.com/v0/agents/${params.agentId}/conversation`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Basic ${Buffer.from(`${params.apiKey}:`).toString('base64')}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        content: `Retrieved ${data.messages.length} messages`,
        metadata: {
          id: data.id,
          messages: data.messages,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable conversation history' },
    metadata: {
      type: 'object',
      description: 'Conversation metadata',
      properties: {
        id: { type: 'string', description: 'Agent ID' },
        messages: {
          type: 'array',
          description: 'Array of conversation messages',
        },
      },
    },
  },
}
