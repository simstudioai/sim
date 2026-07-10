import type { InstagramPublishResponse, InstagramPublishVideoParams } from '@/tools/instagram/types'
import type { ToolConfig } from '@/tools/types'

export const instagramPublishVideoTool: ToolConfig<
  InstagramPublishVideoParams,
  InstagramPublishResponse
> = {
  id: 'instagram_publish_video',
  name: 'Instagram Publish Video',
  description:
    'Create and publish a feed video from an uploaded file or public HTTPS URL (published as a Reel shared to the feed; polls until ready)',
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
      description: 'Video file or public HTTPS URL',
    },
    caption: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Post caption',
    },
    cover: {
      type: 'file',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional JPEG cover image file or public HTTPS URL',
    },
  },

  request: {
    url: '/api/tools/instagram/publish-video',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: InstagramPublishVideoParams) => ({
      accessToken: params.accessToken,
      igUserId: params.igUserId,
      video: params.video,
      cover: params.cover,
      caption: params.caption,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok || data.success === false) {
      return {
        success: false,
        output: data.output || { containerId: null, mediaId: null, statusCode: null },
        error: data.error || 'Failed to publish video',
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
