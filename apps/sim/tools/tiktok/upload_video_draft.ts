import type {
  TikTokUploadVideoDraftParams,
  TikTokUploadVideoDraftResponse,
} from '@/tools/tiktok/types'
import { readTikTokPublishInitResponse, toTikTokPublishToolResponse } from '@/tools/tiktok/utils'
import type { ToolConfig } from '@/tools/types'

export const tiktokUploadVideoDraftTool: ToolConfig<
  TikTokUploadVideoDraftParams,
  TikTokUploadVideoDraftResponse
> = {
  id: 'tiktok_upload_video_draft',
  name: 'TikTok Upload Video Draft',
  description:
    "Send an uploaded video to the authenticated user's TikTok inbox for manual editing and posting. The user must open TikTok and tap the inbox notification to complete the post. Rate limit: 6 requests per minute per user.",
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'tiktok',
    requiredScopes: ['video.upload'],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'TikTok OAuth access token',
    },
    file: {
      type: 'file',
      required: true,
      visibility: 'user-only',
      description: 'Video file to upload from the workflow. Maximum size: 250 MB.',
    },
  },

  request: {
    url: () => '/api/tools/tiktok/publish-video',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: TikTokUploadVideoDraftParams) => ({
      accessToken: params.accessToken,
      mode: 'draft',
      file: params.file,
    }),
  },

  transformResponse: async (response: Response): Promise<TikTokUploadVideoDraftResponse> => {
    const result = await readTikTokPublishInitResponse(response)
    return toTikTokPublishToolResponse(result)
  },

  outputs: {
    publishId: {
      type: 'string',
      description:
        'Unique identifier for tracking the draft status. Use this with the Get Post Status tool to check when the user has completed posting from their inbox.',
    },
  },
}
