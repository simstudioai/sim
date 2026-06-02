import type { LinqUpdateChatParams, LinqUpdateChatResult } from '@/tools/linq/types'
import { extractLinqError, LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqUpdateChatTool: ToolConfig<LinqUpdateChatParams, LinqUpdateChatResult> = {
  id: 'linq_update_chat',
  name: 'Update Chat',
  description: 'Update chat properties such as group display name and icon',
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
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New display name for the group chat',
    },
    groupChatIcon: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New group chat icon (publicly accessible image URL)',
    },
  },

  request: {
    url: (params) => `${LINQ_API_BASE}/chats/${encodeURIComponent(params.chatId.trim())}`,
    method: 'PUT',
    headers: (params) => linqHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.displayName !== undefined) body.display_name = params.displayName
      if (params.groupChatIcon !== undefined) body.group_chat_icon = params.groupChatIcon
      return body
    },
  },

  transformResponse: async (response): Promise<LinqUpdateChatResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractLinqError(data, 'Failed to update chat'),
        output: { chatId: null, status: null },
      }
    }

    return {
      success: true,
      output: {
        chatId: data.chat_id ?? null,
        status: data.status ?? null,
      },
    }
  },

  outputs: {
    chatId: { type: 'string', description: 'ID of the updated chat', optional: true },
    status: { type: 'string', description: 'Status of the queued update', optional: true },
  },
}
