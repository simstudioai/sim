import type {
  TikTokUploadPhotoDraftParams,
  TikTokUploadPhotoDraftResponse,
} from '@/tools/tiktok/types'
import {
  readTikTokPublishInitResponse,
  resolveTikTokPhotoCoverIndex,
  toTikTokPublishToolResponse,
} from '@/tools/tiktok/utils'
import type { ToolConfig } from '@/tools/types'

export const tiktokUploadPhotoDraftTool: ToolConfig<
  TikTokUploadPhotoDraftParams,
  TikTokUploadPhotoDraftResponse
> = {
  id: 'tiktok_upload_photo_draft',
  name: 'TikTok Upload Photo Draft',
  description:
    "Send one or more photos (from public URLs) to the authenticated user's TikTok inbox for manual editing and posting. The user must open TikTok and tap the inbox notification to complete the post. Photos only support PULL_FROM_URL (no file upload). Rate limit: 6 requests per minute per user.",
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
    photoImages: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Public, verified-domain URLs of the images to upload (up to 35). Must be JPEG or WEBP — TikTok rejects PNG.',
      items: {
        type: 'string',
        description: 'Public image URL',
      },
    },
    photoCoverIndex: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 0,
      description: 'Index (starting from 0) of the photo to use as the cover.',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Post title. Maximum 90 characters.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Post description. Maximum 4000 characters.',
    },
  },

  request: {
    url: () => 'https://open.tiktokapis.com/v2/post/publish/content/init/',
    method: 'POST',
    headers: (params: TikTokUploadPhotoDraftParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    }),
    body: (params: TikTokUploadPhotoDraftParams) => {
      const photoCoverIndex = resolveTikTokPhotoCoverIndex(
        params.photoImages,
        params.photoCoverIndex
      )

      const postInfo: Record<string, unknown> = {}

      if (params.title) postInfo.title = params.title
      if (params.description) postInfo.description = params.description

      return {
        media_type: 'PHOTO',
        post_mode: 'MEDIA_UPLOAD',
        post_info: postInfo,
        source_info: {
          source: 'PULL_FROM_URL',
          photo_images: params.photoImages,
          photo_cover_index: photoCoverIndex,
        },
      }
    },
  },

  transformResponse: async (response: Response): Promise<TikTokUploadPhotoDraftResponse> => {
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
