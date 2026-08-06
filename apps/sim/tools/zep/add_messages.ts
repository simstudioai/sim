import type { ToolConfig } from '@/tools/types'
import type { ZepResponse } from '@/tools/zep/types'
import { THREAD_OUTPUT_PROPERTIES } from '@/tools/zep/types'

interface ZepAddMessagesParams {
  threadId: string
  messages: string | Record<string, unknown>[]
  apiKey: string
}

function parseZepMessages(input: ZepAddMessagesParams['messages']): Record<string, unknown>[] {
  let parsed: unknown = input
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      throw new Error('Messages must be a valid JSON array')
    }
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Messages must be a non-empty array')
  }

  for (const message of parsed) {
    if (
      typeof message !== 'object' ||
      message === null ||
      Array.isArray(message) ||
      !('role' in message) ||
      !message.role ||
      !('content' in message) ||
      !message.content
    ) {
      throw new Error('Each message must have role and content properties')
    }
  }

  return parsed as Record<string, unknown>[]
}

function rebuildZepMessages(
  original: ZepAddMessagesParams['messages'],
  projectedContent: unknown
): ZepAddMessagesParams['messages'] {
  const messages = parseZepMessages(original)
  if (!Array.isArray(projectedContent) || projectedContent.length !== messages.length) {
    throw new Error('Projected Zep messages do not match the original messages')
  }

  const rebuilt = messages.map((message, index) => ({
    ...message,
    content: projectedContent[index],
  }))
  return typeof original === 'string' ? JSON.stringify(rebuilt) : rebuilt
}

export const zepAddMessagesTool: ToolConfig<ZepAddMessagesParams, ZepResponse> = {
  id: 'zep_add_messages',
  name: 'Add Messages',
  description: 'Add messages to an existing thread',
  version: '1.0.0',

  params: {
    threadId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Thread ID to add messages to (e.g., "thread_abc123")',
    },
    messages: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of message objects with role and content (e.g., [{"role": "user", "content": "Hello"}])',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Zep API key',
    },
  },

  request: {
    modelInput: {
      mode: 'project',
      select: (params) => ({
        messages: parseZepMessages(params.messages).map((message) => message.content),
      }),
      applyProjected: (selectedParams, projectedSelection) => {
        if (selectedParams.messages === undefined) {
          throw new Error('Zep messages are required')
        }
        return {
          messages: rebuildZepMessages(selectedParams.messages, projectedSelection.messages),
        }
      },
    },
    url: (params) => `https://api.getzep.com/api/v2/threads/${params.threadId}/messages`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Api-Key ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      messages: parseZepMessages(params.messages),
    }),
  },

  transformResponse: async (response, params) => {
    if (!params) throw new Error('Zep add messages response is missing request context')
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
    threadId: THREAD_OUTPUT_PROPERTIES.threadId,
    added: {
      type: 'boolean',
      description: 'Whether messages were added successfully',
    },
    messageIds: {
      type: 'array',
      description: 'Array of added message UUIDs',
      items: {
        type: 'string',
        description: 'Message UUID',
      },
    },
  },
}
