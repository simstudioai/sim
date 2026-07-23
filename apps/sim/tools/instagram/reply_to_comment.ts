import type {
  InstagramReplyToCommentParams,
  InstagramReplyToCommentResponse,
} from '@/tools/instagram/types'
import {
  graphUrl,
  idString,
  jsonBearerHeaders,
  readGraphError,
  readGraphJson,
} from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

export const instagramReplyToCommentTool: ToolConfig<
  InstagramReplyToCommentParams,
  InstagramReplyToCommentResponse
> = {
  id: 'instagram_reply_to_comment',
  name: 'Instagram Reply to Comment',
  description: 'Reply to a comment on Instagram media',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'instagram',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Instagram API',
    },
    commentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comment id to reply to',
    },
    message: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Reply text',
    },
  },

  request: {
    url: (params) => graphUrl(`/${params.commentId.trim()}/replies`),
    method: 'POST',
    headers: (params) => jsonBearerHeaders(params.accessToken),
    body: (params) => ({ message: params.message }),
  },

  transformResponse: async (response): Promise<InstagramReplyToCommentResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: { id: null },
        error: await readGraphError(response),
      }
    }

    const data = await readGraphJson<{ id?: string | number }>(
      response,
      'Instagram reply comment response'
    )
    const id = idString(data.id)
    if (!id) {
      return {
        success: false,
        output: { id: null },
        error: 'Instagram reply response did not include a comment id',
      }
    }

    return {
      success: true,
      output: { id },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Created reply comment id' },
  },
}
