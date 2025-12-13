import type { ToolConfig } from '@/tools/types'
import type { ZepResponse } from '@/tools/zep/types'

// Add Messages Tool - Add messages to a thread (Zep v3)
export const zepAddMessagesTool: ToolConfig<any, ZepResponse> = {
  id: 'zep_add_messages',
  name: 'Add Messages',
  description: 'Add messages to an existing thread',
  version: '1.0.0',

  params: {
    threadId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Thread ID to add messages to',
    },
    messages: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of message objects with role and content',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Zep API key',
    },
  },

  request: {
    url: (params) => `https://api.getzep.com/api/v2/threads/${params.threadId}/messages`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Api-Key ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      let messagesArray = params.messages
      if (typeof messagesArray === 'string') {
        try {
          messagesArray = JSON.parse(messagesArray)
        } catch (_e) {
          throw new Error('Messages must be a valid JSON array')
        }
      }

      if (!Array.isArray(messagesArray) || messagesArray.length === 0) {
        throw new Error('Messages must be a non-empty array')
      }

      for (const msg of messagesArray) {
        if (!msg.role || !msg.content) {
          throw new Error('Each message must have role and content properties')
        }
      }

      return {
        messages: messagesArray,
      }
    },
  },

  transformResponse: async (response, params) => {
    const threadId = params.threadId

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Zep API error (${response.status}): ${error || response.statusText}`)
    }

    const text = await response.text()
    if (!text || text.trim() === '') {
      return {
        success: true,
        output: {
          threadId,
          added: true,
          messageIds: [],
        },
      }
    }

    const data = JSON.parse(text)

    return {
      success: true,
      output: {
        threadId,
        added: true,
        messageIds: data.message_uuids || [],
      },
    }
  },

  outputs: {
    threadId: {
      type: 'string',
      description: 'The thread ID',
    },
    added: {
      type: 'boolean',
      description: 'Whether messages were added successfully',
    },
    messageIds: {
      type: 'array',
      description: 'Array of added message UUIDs',
    },
  },
}
