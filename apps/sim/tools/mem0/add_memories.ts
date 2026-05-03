import { toError } from '@sim/utils/errors'
import {
  ADD_MEMORY_OUTPUT_PROPERTIES,
  type Mem0AddMemoriesParams,
  type Mem0AddMemoriesResponse,
  type Mem0Message,
} from '@/tools/mem0/types'
import type { ToolConfig } from '@/tools/types'

function parseMessages(messages: Mem0AddMemoriesParams['messages']): Mem0Message[] {
  let parsed: unknown
  try {
    parsed = typeof messages === 'string' ? JSON.parse(messages) : messages
  } catch (error) {
    throw new Error(`Messages must be valid JSON: ${toError(error).message}`)
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Messages must be a non-empty array')
  }

  for (const message of parsed) {
    if (
      !message ||
      typeof message !== 'object' ||
      (message.role !== 'user' && message.role !== 'assistant') ||
      typeof message.content !== 'string' ||
      message.content.length === 0
    ) {
      throw new Error('Each message must have role user or assistant and non-empty content')
    }
  }

  return parsed
}

/**
 * Add Memories Tool
 * @see https://docs.mem0.ai/api-reference/memory/add-memories
 */
export const mem0AddMemoriesTool: ToolConfig<Mem0AddMemoriesParams, Mem0AddMemoriesResponse> = {
  id: 'mem0_add_memories',
  name: 'Add Memories',
  description: 'Add memories to Mem0 for persistent storage and retrieval',
  version: '1.0.0',

  params: {
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID associated with the memory (e.g., "user_123", "alice@example.com")',
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
      description: 'Your Mem0 API key',
    },
  },

  request: {
    url: 'https://api.mem0.ai/v3/memories/add/',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Token ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const messages = parseMessages(params.messages)
      return {
        messages,
        user_id: params.userId.trim(),
      }
    },
  },

  transformResponse: async (response): Promise<Mem0AddMemoriesResponse> => {
    const data = await response.json()
    return {
      success: true,
      output: {
        message: data.message ?? '',
        status: data.status ?? '',
        event_id: data.event_id ?? '',
      },
    }
  },

  outputs: {
    message: ADD_MEMORY_OUTPUT_PROPERTIES.message,
    status: ADD_MEMORY_OUTPUT_PROPERTIES.status,
    event_id: ADD_MEMORY_OUTPUT_PROPERTIES.event_id,
  },
}
