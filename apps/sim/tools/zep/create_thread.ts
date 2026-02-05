import type { ToolConfig } from '@/tools/types'
import type { ZepResponse } from '@/tools/zep/types'
import { THREAD_OUTPUT_PROPERTIES } from '@/tools/zep/types'

export const zepCreateThreadTool: ToolConfig<any, ZepResponse> = {
  id: 'zep_create_thread',
  name: 'Create Thread',
  description: 'Start a new conversation thread in Zep',
  version: '1.0.0',

  params: {
    threadId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique identifier for the thread (e.g., "thread_abc123")',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID associated with the thread (e.g., "user_123")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Zep API key',
    },
  },

  request: {
    url: 'https://api.getzep.com/api/v2/threads',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Api-Key ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      thread_id: params.threadId,
      user_id: params.userId,
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Zep API error (${response.status}): ${error || response.statusText}`)
    }

    const text = await response.text()
    if (!text || text.trim() === '') {
      return {
        success: true,
        output: {},
      }
    }

    const data = JSON.parse(text)

    return {
      success: true,
      output: {
        threadId: data.thread_id,
        userId: data.user_id,
        uuid: data.uuid,
        createdAt: data.created_at,
        projectUuid: data.project_uuid,
      },
    }
  },

  outputs: {
    threadId: THREAD_OUTPUT_PROPERTIES.threadId,
    userId: THREAD_OUTPUT_PROPERTIES.userId,
    uuid: THREAD_OUTPUT_PROPERTIES.uuid,
    createdAt: THREAD_OUTPUT_PROPERTIES.createdAt,
    projectUuid: THREAD_OUTPUT_PROPERTIES.projectUuid,
  },
}
