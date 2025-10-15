import type { ToolConfig } from '@/tools/types'
import type { ZepResponse } from '@/tools/zep/types'

// Delete Thread Tool - Delete a thread (Zep v3)
export const zepDeleteThreadTool: ToolConfig<any, ZepResponse> = {
  id: 'zep_delete_thread',
  name: 'Delete Thread',
  description: 'Delete a conversation thread from Zep',
  version: '1.0.0',

  params: {
    threadId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Thread ID to delete',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Zep API key',
    },
  },

  request: {
    url: (params) => `https://api.getzep.com/api/v2/threads/${params.threadId}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Api-Key ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const text = await response.text()

    if (!response.ok) {
      throw new Error(`Zep API error (${response.status}): ${text || response.statusText}`)
    }

    return {
      success: true,
      output: {
        deleted: true,
      },
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Whether the thread was deleted',
    },
  },
}
