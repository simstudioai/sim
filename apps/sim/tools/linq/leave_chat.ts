import type { LinqChatActionParams, LinqQueuedResult } from '@/tools/linq/types'
import { extractLinqError, LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqLeaveChatTool: ToolConfig<LinqChatActionParams, LinqQueuedResult> = {
  id: 'linq_leave_chat',
  name: 'Leave Chat',
  description:
    'Leave an iMessage group chat (4+ active participants; not supported for direct chats)',
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
      description: 'The unique identifier of the group chat',
    },
  },

  request: {
    url: (params) => `${LINQ_API_BASE}/chats/${encodeURIComponent(params.chatId.trim())}/leave`,
    method: 'POST',
    headers: (params) => linqHeaders(params.apiKey),
  },

  transformResponse: async (response): Promise<LinqQueuedResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractLinqError(data, 'Failed to leave chat'),
        output: { message: null, status: null, traceId: null },
      }
    }

    return {
      success: true,
      output: {
        message: data.message ?? null,
        status: data.status ?? null,
        traceId: data.trace_id ?? null,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Human-readable status message', optional: true },
    status: { type: 'string', description: 'Queued action status (e.g. accepted)', optional: true },
    traceId: { type: 'string', description: 'Trace ID for the queued action', optional: true },
  },
}
