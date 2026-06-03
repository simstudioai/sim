import type { LinqQueuedResult, LinqReactToMessageParams } from '@/tools/linq/types'
import { extractLinqError, LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqReactToMessageTool: ToolConfig<LinqReactToMessageParams, LinqQueuedResult> = {
  id: 'linq_react_to_message',
  name: 'React to Message',
  description: 'Add or remove a tapback reaction on a message',
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
      description: 'The unique identifier of the message to react to',
    },
    operation: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether to add or remove the reaction: add or remove',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Reaction type: love, like, dislike, laugh, emphasize, question, custom, or sticker',
    },
    customEmoji: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Emoji to use when type is custom',
    },
    partIndex: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Index of the message part to react to (defaults to the entire message)',
    },
  },

  request: {
    url: (params) =>
      `${LINQ_API_BASE}/messages/${encodeURIComponent(params.messageId.trim())}/reactions`,
    method: 'POST',
    headers: (params) => linqHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        operation: params.operation,
        type: params.type,
      }
      if (params.customEmoji) body.custom_emoji = params.customEmoji
      if (typeof params.partIndex === 'number') body.part_index = params.partIndex
      return body
    },
  },

  transformResponse: async (response): Promise<LinqQueuedResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractLinqError(data, 'Failed to react to message'),
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
    status: { type: 'string', description: 'Queued action status', optional: true },
    traceId: { type: 'string', description: 'Trace ID for the queued action', optional: true },
  },
}
