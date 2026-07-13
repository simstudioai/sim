import {
  type InstagramPublishResponse,
  type InstagramPublishStoryParams,
  PUBLISH_OUTPUTS,
} from '@/tools/instagram/types'
import { createPublishTransform } from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

export const instagramPublishStoryTool: ToolConfig<
  InstagramPublishStoryParams,
  InstagramPublishResponse
> = {
  id: 'instagram_publish_story',
  name: 'Instagram Publish Story',
  description:
    'Publish an image or video story for an Instagram Business account from an uploaded file or public HTTPS URL',
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
      type: 'file',
      required: true,
      visibility: 'user-or-llm',
      description: 'JPEG image or MP4/MOV video file, or a public HTTPS URL',
    },
  },

  request: {
    url: '/api/tools/instagram/publish-story',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: InstagramPublishStoryParams) => ({
      accessToken: params.accessToken,
      igUserId: params.igUserId,
      media: params.media,
    }),
  },

  transformResponse: createPublishTransform('Failed to publish story'),

  outputs: PUBLISH_OUTPUTS,
}
