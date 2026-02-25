import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioCreateCommentParams, AttioCreateCommentResponse } from './types'
import { COMMENT_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioCreateComment')

export const attioCreateCommentTool: ToolConfig<
  AttioCreateCommentParams,
  AttioCreateCommentResponse
> = {
  id: 'attio_create_comment',
  name: 'Attio Create Comment',
  description: 'Create a comment on a list entry in Attio',
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
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The comment content',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Content format: plaintext or markdown (default plaintext)',
    },
    authorType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Author type (e.g. workspace-member)',
    },
    authorId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Author workspace member ID',
    },
    list: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The list ID or slug the entry belongs to',
    },
    entryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The entry ID to comment on',
    },
    threadId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Thread ID to reply to (omit to start a new thread)',
    },
    createdAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Backdate the comment (ISO 8601 format)',
    },
  },

  request: {
    url: 'https://api.attio.com/v2/comments',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const data: Record<string, unknown> = {
        format: params.format || 'plaintext',
        content: params.content,
        author: {
          type: params.authorType,
          id: params.authorId,
        },
        entry: {
          list: params.list,
          entry_id: params.entryId,
        },
      }
      if (params.threadId) data.thread_id = params.threadId
      if (params.createdAt) data.created_at = params.createdAt
      return { data }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to create comment')
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
