import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioGetThreadParams, AttioGetThreadResponse } from './types'
import { THREAD_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioGetThread')

export const attioGetThreadTool: ToolConfig<AttioGetThreadParams, AttioGetThreadResponse> = {
  id: 'attio_get_thread',
  name: 'Attio Get Thread',
  description: 'Get a single comment thread by ID from Attio',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'attio',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The OAuth access token for the Attio API',
    },
    threadId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The thread ID',
    },
  },

  request: {
    url: (params) => `https://api.attio.com/v2/threads/${params.threadId}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to get thread')
    }
    const t = data.data
    const comments =
      (
        t.comments as Array<{
          id?: { comment_id?: string }
          content_plaintext?: string
          author?: { type?: string; id?: string }
          created_at?: string
        }>
      )?.map((c) => ({
        commentId: c.id?.comment_id ?? null,
        contentPlaintext: c.content_plaintext ?? null,
        author: c.author ? { type: c.author.type ?? null, id: c.author.id ?? null } : null,
        createdAt: c.created_at ?? null,
      })) ?? []
    return {
      success: true,
      output: {
        threadId: t.id?.thread_id ?? null,
        comments,
        createdAt: t.created_at ?? null,
      },
    }
  },

  outputs: THREAD_OUTPUT_PROPERTIES,
}
