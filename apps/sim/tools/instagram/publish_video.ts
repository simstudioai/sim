import type { InstagramPublishResponse, InstagramPublishVideoParams } from '@/tools/instagram/types'
import {
  createMediaContainer,
  publishMediaContainer,
  resolveIgUserId,
  waitForContainerReady,
} from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

export const instagramPublishVideoTool: ToolConfig<
  InstagramPublishVideoParams,
  InstagramPublishResponse
> = {
  id: 'instagram_publish_video',
  name: 'Instagram Publish Video',
  description:
    'Create and publish a feed video from a public URL (published as a Reel shared to the feed; polls until ready)',
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
      description: 'Public HTTPS URL of the video file',
    },
    caption: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Post caption',
    },
    coverUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional public JPEG cover image URL',
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
      // Meta deprecated media_type=VIDEO for standalone posts (Nov 2023);
      // feed videos must be published as REELS shared to the feed.
      const body: Record<string, unknown> = {
        media_type: 'REELS',
        video_url: params.videoUrl,
        share_to_feed: true,
      }
      if (params.caption) body.caption = params.caption
      if (params.coverUrl) body.cover_url = params.coverUrl

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
        error: error instanceof Error ? error.message : 'Failed to publish video',
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
