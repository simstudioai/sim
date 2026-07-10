import type {
  InstagramReplyToCommentParams,
  InstagramReplyToCommentResponse,
} from '@/tools/instagram/types'
import { bearerHeaders, graphUrl, idString, readGraphError } from '@/tools/instagram/utils'
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
    // Graph comment endpoints document message as a query/form parameter, not
    // a JSON body (same style as hide_comment and set_comments_enabled).
    url: (params) => graphUrl(`/${params.commentId.trim()}/replies`, { message: params.message }),
    method: 'POST',
    headers: (params) => bearerHeaders(params.accessToken),
  },

  transformResponse: async (response): Promise<InstagramReplyToCommentResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: { id: null },
        error: await readGraphError(response),
      }
    }

    const data = await response.json()
    return {
      success: true,
      output: { id: idString(data.id) },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Created reply comment id', optional: true },
  },
}
