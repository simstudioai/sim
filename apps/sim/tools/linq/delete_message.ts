import type { LinqDeleteMessageParams, LinqSuccessResult } from '@/tools/linq/types'
import { extractLinqError, LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqDeleteMessageTool: ToolConfig<LinqDeleteMessageParams, LinqSuccessResult> = {
  id: 'linq_delete_message',
  name: 'Delete Message',
  description:
    'Delete a message from the Linq API only (does not unsend it; recipients still see it)',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Linq API key',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the message to delete',
    },
  },

  request: {
    url: (params) => `${LINQ_API_BASE}/messages/${encodeURIComponent(params.messageId.trim())}`,
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
      error: extractLinqError(data, 'Failed to delete message'),
      output: { success: false },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the message was deleted' },
  },
}
