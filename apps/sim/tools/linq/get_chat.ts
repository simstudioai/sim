import type { LinqChatResult, LinqGetChatParams } from '@/tools/linq/types'
import { extractLinqError, LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqGetChatTool: ToolConfig<LinqGetChatParams, LinqChatResult> = {
  id: 'linq_get_chat',
  name: 'Get Chat',
  description: 'Retrieve a chat by ID, including participants and line health',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Linq API key',
    },
    chatId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the chat',
    },
  },

  request: {
    url: (params) => `${LINQ_API_BASE}/chats/${encodeURIComponent(params.chatId.trim())}`,
    method: 'GET',
    headers: (params) => linqHeaders(params.apiKey),
  },

  transformResponse: async (response): Promise<LinqChatResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractLinqError(data, 'Failed to get chat'),
        output: {
          id: '',
          displayName: '',
          isGroup: false,
          isArchived: null,
          service: null,
          createdAt: null,
          updatedAt: null,
          handles: [],
          healthStatus: null,
        },
      }
    }

    return {
      success: true,
      output: {
        id: data.id ?? '',
        displayName: data.display_name ?? '',
        isGroup: data.is_group ?? false,
        isArchived: data.is_archived ?? null,
        service: data.service ?? null,
        createdAt: data.created_at ?? null,
        updatedAt: data.updated_at ?? null,
        handles: data.handles ?? [],
        healthStatus: data.health_status ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Chat ID' },
    displayName: { type: 'string', description: 'Display name of the chat' },
    isGroup: { type: 'boolean', description: 'Whether the chat is a group chat' },
    isArchived: { type: 'boolean', description: 'Whether the chat is archived', optional: true },
    service: {
      type: 'string',
      description: 'Delivery service (iMessage, SMS, RCS)',
      optional: true,
    },
    createdAt: { type: 'string', description: 'ISO 8601 creation timestamp', optional: true },
    updatedAt: { type: 'string', description: 'ISO 8601 update timestamp', optional: true },
    handles: { type: 'json', description: 'Participant handles in the chat' },
    healthStatus: { type: 'json', description: 'Messaging line health status', optional: true },
  },
}
