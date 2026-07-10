import type {
  InstagramSetCommentsEnabledParams,
  InstagramSetCommentsEnabledResponse,
} from '@/tools/instagram/types'
import { bearerHeaders, graphUrl, readGraphError } from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

export const instagramSetCommentsEnabledTool: ToolConfig<
  InstagramSetCommentsEnabledParams,
  InstagramSetCommentsEnabledResponse
> = {
  id: 'instagram_set_comments_enabled',
  name: 'Instagram Set Comments Enabled',
  description: 'Enable or disable comments on an Instagram media object',
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
    mediaId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Instagram media id',
    },
    commentEnabled: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'True to enable comments, false to disable',
    },
  },

  request: {
    url: (params) =>
      graphUrl(`/${params.mediaId.trim()}`, { comment_enabled: String(params.commentEnabled) }),
    method: 'POST',
    headers: (params) => bearerHeaders(params.accessToken),
  },

  transformResponse: async (response): Promise<InstagramSetCommentsEnabledResponse> => {
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
    success: { type: 'boolean', description: 'Whether the update succeeded' },
  },
}
