import type { LinqChatActionParams, LinqSuccessResult } from '@/tools/linq/types'
import { extractLinqError, LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqStartTypingTool: ToolConfig<LinqChatActionParams, LinqSuccessResult> = {
  id: 'linq_start_typing',
  name: 'Start Typing Indicator',
  description: 'Show a typing indicator in a one-on-one chat (iMessage only, not group chats)',
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
    url: (params) => `${LINQ_API_BASE}/chats/${encodeURIComponent(params.chatId.trim())}/typing`,
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
      error: extractLinqError(data, 'Failed to start typing indicator'),
      output: { success: false },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the typing indicator was sent' },
  },
}
