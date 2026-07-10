import type {
  InstagramDeleteCommentParams,
  InstagramDeleteCommentResponse,
} from '@/tools/instagram/types'
import { bearerHeaders, graphUrl, readGraphError } from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

export const instagramDeleteCommentTool: ToolConfig<
  InstagramDeleteCommentParams,
  InstagramDeleteCommentResponse
> = {
  id: 'instagram_delete_comment',
  name: 'Instagram Delete Comment',
  description: 'Delete a comment on Instagram media',
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
      description: 'Comment id to delete',
    },
  },

  request: {
    url: (params) => graphUrl(`/${params.commentId.trim()}`),
    method: 'DELETE',
    headers: (params) => bearerHeaders(params.accessToken),
  },

  transformResponse: async (response): Promise<InstagramDeleteCommentResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: { success: false },
        error: await readGraphError(response),
      }
    }

    const data = await response.json().catch(() => ({ success: true }))
    return {
      success: true,
      output: { success: data.success !== false },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the delete succeeded' },
  },
}
