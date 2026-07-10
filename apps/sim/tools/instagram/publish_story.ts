import type { InstagramPublishResponse, InstagramPublishStoryParams } from '@/tools/instagram/types'
import {
  createMediaContainer,
  publishMediaContainer,
  resolveIgUserId,
  waitForContainerReady,
} from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

export const instagramPublishStoryTool: ToolConfig<
  InstagramPublishStoryParams,
  InstagramPublishResponse
> = {
  id: 'instagram_publish_story',
  name: 'Instagram Publish Story',
  description: 'Publish an image or video story from a public URL',
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
    imageUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Public HTTPS JPEG URL for an image story',
    },
    videoUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Public HTTPS video URL for a video story',
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

    const imageUrl = params.imageUrl?.trim() || undefined
    const videoUrl = params.videoUrl?.trim() || undefined

    if (!imageUrl && !videoUrl) {
      return {
        success: false,
        output: { containerId: null, mediaId: null, statusCode: null },
        error: 'Provide either imageUrl or videoUrl for a story',
      }
    }

    if (imageUrl && videoUrl) {
      return {
        success: false,
        output: { containerId: null, mediaId: null, statusCode: null },
        error: 'Provide only one of imageUrl or videoUrl for a story, not both',
      }
    }

    try {
      const igUserId = await resolveIgUserId(params.accessToken, params.igUserId)
      const body: Record<string, unknown> = {
        media_type: 'STORIES',
      }
      if (videoUrl) {
        body.video_url = videoUrl
      } else if (imageUrl) {
        body.image_url = imageUrl
      }

      const containerId = await createMediaContainer(params.accessToken, igUserId, body)
      // Images and videos both need FINISHED before media_publish (code 9007 otherwise).
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
        error: error instanceof Error ? error.message : 'Failed to publish story',
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
