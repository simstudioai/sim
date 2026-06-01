import type { LinqChatActionParams, LinqSuccessResult } from '@/tools/linq/types'
import { extractLinqError, LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqStopTypingTool: ToolConfig<LinqChatActionParams, LinqSuccessResult> = {
  id: 'linq_stop_typing',
  name: 'Stop Typing Indicator',
  description: 'Stop the typing indicator in a one-on-one chat (iMessage only, not group chats)',
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
    method: 'DELETE',
    headers: (params) => linqHeaders(params.apiKey),
  },

  transformResponse: async (response): Promise<LinqSuccessResult> => {
    if (response.ok) {
      return { success: true, output: { success: true } }
    }
    const data = await response.json().catch(() => null)
    return {
      success: false,
      error: extractLinqError(data, 'Failed to stop typing indicator'),
      output: { success: false },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the typing indicator was stopped' },
  },
}
