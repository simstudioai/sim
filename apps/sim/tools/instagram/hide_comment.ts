import type {
  InstagramHideCommentParams,
  InstagramHideCommentResponse,
} from '@/tools/instagram/types'
import { bearerHeaders, graphUrl, readGraphError } from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

export const instagramHideCommentTool: ToolConfig<
  InstagramHideCommentParams,
  InstagramHideCommentResponse
> = {
  id: 'instagram_hide_comment',
  name: 'Instagram Hide Comment',
  description: 'Hide or unhide a comment on Instagram media',
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
      description: 'Comment id',
    },
    hide: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'True to hide, false to unhide',
    },
  },

  request: {
    url: (params) => graphUrl(`/${params.commentId.trim()}`, { hide: String(params.hide) }),
    method: 'POST',
    headers: (params) => bearerHeaders(params.accessToken),
  },

  transformResponse: async (response): Promise<InstagramHideCommentResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: { success: false },
        error: await readGraphError(response),
      }
    }

    const data = await response.json()
    return {
      success: true,
      output: { success: data.success === true || data.success === undefined },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the hide/unhide succeeded' },
  },
}
