import {
  type InstagramPublishImageParams,
  type InstagramPublishResponse,
  PUBLISH_OUTPUTS,
} from '@/tools/instagram/types'
import { createPublishTransform } from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

export const instagramPublishImageTool: ToolConfig<
  InstagramPublishImageParams,
  InstagramPublishResponse
> = {
  id: 'instagram_publish_image',
  name: 'Instagram Publish Image',
  description:
    'Create and publish a single JPEG image post from an uploaded file or public HTTPS URL (polls until the container is ready)',
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
    image: {
      type: 'file',
      required: true,
      visibility: 'user-or-llm',
      description: 'JPEG image file or public HTTPS URL (Meta will download it)',
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
    url: '/api/tools/instagram/publish-image',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: InstagramPublishImageParams) => ({
      accessToken: params.accessToken,
      igUserId: params.igUserId,
      image: params.image,
      caption: params.caption,
      altText: params.altText,
      isAiGenerated: params.isAiGenerated,
    }),
  },

  transformResponse: createPublishTransform('Failed to publish image'),

  outputs: PUBLISH_OUTPUTS,
}
