import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioGetCommentParams, AttioGetCommentResponse } from './types'
import { COMMENT_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioGetComment')

export const attioGetCommentTool: ToolConfig<AttioGetCommentParams, AttioGetCommentResponse> = {
  id: 'attio_get_comment',
  name: 'Attio Get Comment',
  description: 'Get a single comment by ID from Attio',
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
    commentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The comment ID',
    },
  },

  request: {
    url: (params) => `https://api.attio.com/v2/comments/${params.commentId}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to get comment')
    }
    const c = data.data
    const author = c.author as { type?: string; id?: string } | undefined
    const entry = c.entry as { list_id?: string; entry_id?: string } | undefined
    const record = c.record as { object_id?: string; record_id?: string } | undefined
    const resolvedBy = c.resolved_by as { type?: string; id?: string } | undefined
    return {
      success: true,
      output: {
        commentId: c.id?.comment_id ?? null,
        threadId: c.thread_id ?? null,
        contentPlaintext: c.content_plaintext ?? null,
        author: author ? { type: author.type ?? null, id: author.id ?? null } : null,
        entry: entry ? { listId: entry.list_id ?? null, entryId: entry.entry_id ?? null } : null,
        record: record
          ? { objectId: record.object_id ?? null, recordId: record.record_id ?? null }
          : null,
        resolvedAt: c.resolved_at ?? null,
        resolvedBy: resolvedBy
          ? { type: resolvedBy.type ?? null, id: resolvedBy.id ?? null }
          : null,
        createdAt: c.created_at ?? null,
      },
    }
  },

  outputs: COMMENT_OUTPUT_PROPERTIES,
}
