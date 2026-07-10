import type { InstagramPublishImageParams, InstagramPublishResponse } from '@/tools/instagram/types'
import {
  createMediaContainer,
  publishMediaContainer,
  resolveIgUserId,
  waitForContainerReady,
} from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

export const instagramPublishImageTool: ToolConfig<
  InstagramPublishImageParams,
  InstagramPublishResponse
> = {
  id: 'instagram_publish_image',
  name: 'Instagram Publish Image',
  description:
    'Create and publish a single JPEG image post from a public URL (polls until the container is ready)',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'Public HTTPS URL of a JPEG image (Meta will download it)',
    },
    caption: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Post caption (max 2200 characters)',
    },
    altText: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Accessibility alt text for the image',
    },
    isAiGenerated: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Mark the post as AI-generated',
    },
  },

  request: {
    // Dummy request — real work happens in postProcess
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
        image_url: params.imageUrl,
      }
      if (params.caption) body.caption = params.caption
      if (params.altText) body.alt_text = params.altText
      if (params.isAiGenerated === true) body.is_ai_generated = true

      const containerId = await createMediaContainer(params.accessToken, igUserId, body)
      // Meta downloads/processes the image asynchronously; publishing before
      // status_code=FINISHED returns "Media ID is not available" (code 9007).
      const { statusCode } = await waitForContainerReady(params.accessToken, containerId)
      const mediaId = await publishMediaContainer(params.accessToken, igUserId, containerId)

      return {
        success: true,
        output: {
          containerId,
          mediaId,
          statusCode,
        },
      }
    } catch (error) {
      return {
        success: false,
        output: { containerId: null, mediaId: null, statusCode: null },
        error: error instanceof Error ? error.message : 'Failed to publish image',
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
