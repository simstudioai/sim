import type { InstagramPublishResponse, InstagramPublishStoryParams } from '@/tools/instagram/types'
import type { ToolConfig } from '@/tools/types'

export const instagramPublishStoryTool: ToolConfig<
  InstagramPublishStoryParams,
  InstagramPublishResponse
> = {
  id: 'instagram_publish_story',
  name: 'Instagram Publish Story',
  description: 'Publish an image or video story from an uploaded file or public HTTPS URL',
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

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok || data.success === false) {
      return {
        success: false,
        output: data.output || { containerId: null, mediaId: null, statusCode: null },
        error: data.error || 'Failed to publish story',
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
