import type { ToolConfig } from '@/tools/types'
import type { ZepResponse } from '@/tools/zep/types'

// Create Thread Tool - Start a new thread (Zep v3)
export const zepCreateThreadTool: ToolConfig<any, ZepResponse> = {
  id: 'zep_create_thread',
  name: 'Create Thread',
  description: 'Start a new conversation thread in Zep',
  version: '1.0.0',

  params: {
    threadId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Unique identifier for the thread',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'User ID associated with the thread',
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
    const text = await response.text()

    if (!response.ok) {
      throw new Error(`Zep API error (${response.status}): ${text || response.statusText}`)
    }

    if (!text || text.trim() === '') {
      return {
        success: true,
        output: {},
      }
    }

    const data = JSON.parse(text.replace(/^\uFEFF/, '').trim())

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
    threadId: {
      type: 'string',
      description: 'The thread ID',
    },
    userId: {
      type: 'string',
      description: 'The user ID',
    },
    uuid: {
      type: 'string',
      description: 'Internal UUID',
    },
    createdAt: {
      type: 'string',
      description: 'Creation timestamp',
    },
    projectUuid: {
      type: 'string',
      description: 'Project UUID',
    },
  },
}
