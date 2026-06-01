import type { LinqParticipantParams, LinqQueuedResult } from '@/tools/linq/types'
import { extractLinqError, LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqAddParticipantTool: ToolConfig<LinqParticipantParams, LinqQueuedResult> = {
  id: 'linq_add_participant',
  name: 'Add Participant',
  description: 'Add a participant to a group chat (3+ existing participants)',
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
    handle: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Phone number (E.164 format) or email address of the participant to add',
    },
  },

  request: {
    url: (params) =>
      `${LINQ_API_BASE}/chats/${encodeURIComponent(params.chatId.trim())}/participants`,
    method: 'POST',
    headers: (params) => linqHeaders(params.apiKey),
    body: (params) => ({ handle: params.handle }),
  },

  transformResponse: async (response): Promise<LinqQueuedResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractLinqError(data, 'Failed to add participant'),
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
