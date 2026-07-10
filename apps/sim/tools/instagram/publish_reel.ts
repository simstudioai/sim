import type { InstagramPublishReelParams, InstagramPublishResponse } from '@/tools/instagram/types'
import type { ToolConfig } from '@/tools/types'

export const instagramPublishReelTool: ToolConfig<
  InstagramPublishReelParams,
  InstagramPublishResponse
> = {
  id: 'instagram_publish_reel',
  name: 'Instagram Publish Reel',
  description:
    'Create and publish a Reel from an uploaded video file or public HTTPS URL (polls until ready)',
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
    video: {
      type: 'file',
      required: true,
      visibility: 'user-or-llm',
      description: 'Reel video file or public HTTPS URL',
    },
    caption: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reel caption',
    },
    cover: {
      type: 'file',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional JPEG cover image file or public HTTPS URL',
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
    url: '/api/tools/instagram/publish-reel',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: InstagramPublishReelParams) => ({
      accessToken: params.accessToken,
      igUserId: params.igUserId,
      video: params.video,
      cover: params.cover,
      caption: params.caption,
      shareToFeed: params.shareToFeed,
      thumbOffset: params.thumbOffset,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok || data.success === false) {
      return {
        success: false,
        output: data.output || { containerId: null, mediaId: null, statusCode: null },
        error: data.error || 'Failed to publish reel',
      }
    }
    return {
      success: true,
      output: data.output || { containerId: null, mediaId: null, statusCode: null },
    }
  },

  outputs: {
    containerId: { type: 'string', description: 'Media container id', optional: true },
    mediaId: { type: 'string', description: 'Published media id', optional: true },
    statusCode: { type: 'string', description: 'Final container status', optional: true },
  },
}
