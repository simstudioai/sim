import {
  type InstagramPublishResponse,
  type InstagramPublishVideoParams,
  PUBLISH_OUTPUTS,
} from '@/tools/instagram/types'
import { createPublishTransform } from '@/tools/instagram/utils'
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

  transformResponse: createPublishTransform('Failed to publish video'),

  outputs: PUBLISH_OUTPUTS,
}
