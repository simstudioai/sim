import type {
  InstagramPublishCarouselParams,
  InstagramPublishResponse,
} from '@/tools/instagram/types'
import type { ToolConfig } from '@/tools/types'

export const instagramPublishCarouselTool: ToolConfig<
  InstagramPublishCarouselParams,
  InstagramPublishResponse
> = {
  id: 'instagram_publish_carousel',
  name: 'Instagram Publish Carousel',
  description: 'Publish a carousel of 2-10 images/videos from uploaded files or public HTTPS URLs',
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
    media: {
      type: 'file[]',
      required: true,
      visibility: 'user-or-llm',
      description:
        '2-10 media files, or a comma-separated public URL string (prefix videos with video:)',
    },
    caption: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Carousel caption',
    },
  },

  request: {
    url: '/api/tools/instagram/publish-carousel',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: InstagramPublishCarouselParams) => ({
      accessToken: params.accessToken,
      igUserId: params.igUserId,
      media: params.media,
      caption: params.caption,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok || data.success === false) {
      return {
        success: false,
        output: data.output || { containerId: null, mediaId: null, statusCode: null },
        error: data.error || 'Failed to publish carousel',
      }
    }
    return {
      success: true,
      output: data.output || { containerId: null, mediaId: null, statusCode: null },
    }
  },

  outputs: {
    containerId: { type: 'string', description: 'Carousel container id', optional: true },
    mediaId: { type: 'string', description: 'Published media id', optional: true },
    statusCode: { type: 'string', description: 'Final status', optional: true },
  },
}
