import type { InstagramPublishReelParams, InstagramPublishResponse } from '@/tools/instagram/types'
import {
  createMediaContainer,
  publishMediaContainer,
  resolveIgUserId,
  waitForContainerReady,
} from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

export const instagramPublishReelTool: ToolConfig<
  InstagramPublishReelParams,
  InstagramPublishResponse
> = {
  id: 'instagram_publish_reel',
  name: 'Instagram Publish Reel',
  description: 'Create and publish a Reel from a public video URL (polls until ready)',
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
    igUserId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Instagram professional account user id (defaults to /me)',
    },
    videoUrl: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Public HTTPS URL of the Reel video',
    },
    caption: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reel caption',
    },
    coverUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional public JPEG cover image URL',
    },
    shareToFeed: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Also share the Reel to the main feed',
    },
    thumbOffset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Frame offset in milliseconds for the cover thumbnail',
    },
  },

  request: {
    url: () => 'https://graph.instagram.com/v22.0/me?fields=user_id',
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.accessToken}` }),
  },

  postProcess: async (result, params) => {
    if (!result.success) {
      return {
        success: false,
        output: { containerId: null, mediaId: null, statusCode: null },
        error: result.error || 'Failed to resolve Instagram account',
      }
    }

    try {
      const igUserId = await resolveIgUserId(params.accessToken, params.igUserId)
      const body: Record<string, unknown> = {
        media_type: 'REELS',
        video_url: params.videoUrl,
      }
      if (params.caption) body.caption = params.caption
      if (params.coverUrl) body.cover_url = params.coverUrl
      if (params.shareToFeed !== undefined) body.share_to_feed = params.shareToFeed
      if (params.thumbOffset != null) body.thumb_offset = params.thumbOffset

      const containerId = await createMediaContainer(params.accessToken, igUserId, body)
      const { statusCode } = await waitForContainerReady(params.accessToken, containerId)
      const mediaId = await publishMediaContainer(params.accessToken, igUserId, containerId)

      return {
        success: true,
        output: { containerId, mediaId, statusCode },
      }
    } catch (error) {
      return {
        success: false,
        output: { containerId: null, mediaId: null, statusCode: null },
        error: error instanceof Error ? error.message : 'Failed to publish reel',
      }
    }
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      return {
        success: false,
        output: { containerId: null, mediaId: null, statusCode: null },
        error: `Failed to resolve Instagram account: ${response.statusText}`,
      }
    }
    return {
      success: true,
      output: { containerId: null, mediaId: null, statusCode: null },
    }
  },

  outputs: {
    containerId: { type: 'string', description: 'Media container id', optional: true },
    mediaId: { type: 'string', description: 'Published media id', optional: true },
    statusCode: { type: 'string', description: 'Final container status', optional: true },
  },
}
