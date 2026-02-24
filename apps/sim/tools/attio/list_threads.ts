import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioListThreadsParams, AttioListThreadsResponse } from './types'

const logger = createLogger('AttioListThreads')

export const attioListThreadsTool: ToolConfig<AttioListThreadsParams, AttioListThreadsResponse> = {
  id: 'attio_list_threads',
  name: 'Attio List Threads',
  description: 'List comment threads in Attio, optionally filtered by record or list entry',
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
    recordId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by record ID (requires object)',
    },
    object: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Object slug to filter by (requires recordId)',
    },
    entryId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by list entry ID (requires list)',
    },
    list: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'List ID or slug to filter by (requires entryId)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of threads to return (max 50)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of threads to skip for pagination',
    },
  },

  request: {
    url: (params) => {
      const searchParams = new URLSearchParams()
      if (params.recordId) searchParams.set('record_id', params.recordId)
      if (params.object) searchParams.set('object', params.object)
      if (params.entryId) searchParams.set('entry_id', params.entryId)
      if (params.list) searchParams.set('list', params.list)
      if (params.limit !== undefined) searchParams.set('limit', String(params.limit))
      if (params.offset !== undefined) searchParams.set('offset', String(params.offset))
      const qs = searchParams.toString()
      return `https://api.attio.com/v2/threads${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to list threads')
    }
    const threads = (data.data ?? []).map((t: Record<string, unknown>) => {
      const id = t.id as { thread_id?: string } | undefined
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
        threadId: id?.thread_id ?? null,
        comments,
        createdAt: (t.created_at as string) ?? null,
      }
    })
    return {
      success: true,
      output: {
        threads,
        count: threads.length,
      },
    }
  },

  outputs: {
    threads: {
      type: 'array',
      description: 'Array of threads',
      items: {
        type: 'object',
        properties: {
          threadId: { type: 'string', description: 'The thread ID' },
          comments: {
            type: 'array',
            description: 'Comments in the thread',
            items: {
              type: 'object',
              properties: {
                commentId: { type: 'string', description: 'The comment ID' },
                contentPlaintext: { type: 'string', description: 'Comment content' },
                author: {
                  type: 'object',
                  description: 'Comment author',
                  properties: {
                    type: { type: 'string', description: 'Actor type' },
                    id: { type: 'string', description: 'Actor ID' },
                  },
                },
                createdAt: { type: 'string', description: 'When the comment was created' },
              },
            },
          },
          createdAt: { type: 'string', description: 'When the thread was created' },
        },
      },
    },
    count: { type: 'number', description: 'Number of threads returned' },
  },
}
