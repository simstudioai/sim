import type { LinqChatActionParams, LinqSuccessResult } from '@/tools/linq/types'
import { extractLinqError, LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqShareContactCardTool: ToolConfig<LinqChatActionParams, LinqSuccessResult> = {
  id: 'linq_share_contact_card',
  name: 'Share Contact Card',
  description: 'Share your configured contact card (Name and Photo Sharing) with a chat',
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
    url: (params) =>
      `${LINQ_API_BASE}/chats/${encodeURIComponent(params.chatId.trim())}/share_contact_card`,
    method: 'POST',
    headers: (params) => linqHeaders(params.apiKey),
  },

  transformResponse: async (response): Promise<LinqSuccessResult> => {
    if (response.ok) {
      return { success: true, output: { success: true } }
    }
    const data = await response.json().catch(() => null)
    return {
      success: false,
      error: extractLinqError(data, 'Failed to share contact card'),
      output: { success: false },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the contact card was shared' },
  },
}
