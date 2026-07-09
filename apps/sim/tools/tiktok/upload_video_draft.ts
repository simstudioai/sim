import type {
  TikTokUploadVideoDraftParams,
  TikTokUploadVideoDraftResponse,
} from '@/tools/tiktok/types'
import {
  assertTikTokVideoSourceInput,
  readTikTokPublishInitResponse,
  toTikTokPublishToolResponse,
} from '@/tools/tiktok/utils'
import type { ToolConfig } from '@/tools/types'

export const tiktokUploadVideoDraftTool: ToolConfig<
  TikTokUploadVideoDraftParams,
  TikTokUploadVideoDraftResponse
> = {
  id: 'tiktok_upload_video_draft',
  name: 'TikTok Upload Video Draft',
  description:
    "Send a video to the authenticated user's TikTok inbox (by public URL or uploaded file) for manual editing and posting. The user must open TikTok and tap the inbox notification to complete the post. Rate limit: 6 requests per minute per user.",
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
    source: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "Media transfer method: 'PULL_FROM_URL' or 'FILE_UPLOAD'.",
    },
    videoUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Public URL of the video to upload (used when source is PULL_FROM_URL). The domain/URL prefix must be verified in the TikTok developer portal.',
    },
    file: {
      type: 'file',
      required: false,
      visibility: 'user-only',
      description: 'Video file to upload from the workflow (used when source is FILE_UPLOAD).',
    },
  },

  request: {
    url: (params: TikTokUploadVideoDraftParams) =>
      params.source === 'FILE_UPLOAD'
        ? '/api/tools/tiktok/publish-video'
        : 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/',
    method: 'POST',
    headers: (params: TikTokUploadVideoDraftParams) => ({
      ...(params.source !== 'FILE_UPLOAD' && { Authorization: `Bearer ${params.accessToken}` }),
      'Content-Type':
        params.source === 'FILE_UPLOAD' ? 'application/json' : 'application/json; charset=UTF-8',
    }),
    body: (params: TikTokUploadVideoDraftParams) => {
      assertTikTokVideoSourceInput(params.source, params.videoUrl, params.file)
      if (params.source === 'FILE_UPLOAD') {
        return {
          accessToken: params.accessToken,
          mode: 'draft',
          file: params.file,
        }
      }

      return {
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: params.videoUrl,
        },
      }
    },
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
