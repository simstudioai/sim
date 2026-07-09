import type {
  TikTokDirectPostPhotoParams,
  TikTokDirectPostPhotoResponse,
} from '@/tools/tiktok/types'
import {
  readTikTokPublishInitResponse,
  resolveTikTokPhotoCoverIndex,
  toTikTokPublishToolResponse,
} from '@/tools/tiktok/utils'
import type { ToolConfig } from '@/tools/types'

export const tiktokDirectPostPhotoTool: ToolConfig<
  TikTokDirectPostPhotoParams,
  TikTokDirectPostPhotoResponse
> = {
  id: 'tiktok_direct_post_photo',
  name: 'TikTok Direct Post Photo',
  description:
    'Publish one or more photos to TikTok from public URLs. TikTok will fetch each image and post them as a photo carousel. Photos only support PULL_FROM_URL (no file upload). Rate limit: 6 requests per minute per user.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'tiktok',
    requiredScopes: ['video.publish'],
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
        'Public, verified-domain URLs of the images to post (up to 35). Must be JPEG or WEBP — TikTok rejects PNG.',
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
    privacyLevel: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Privacy level for the post. Options: PUBLIC_TO_EVERYONE, MUTUAL_FOLLOW_FRIENDS, FOLLOWER_OF_CREATOR, SELF_ONLY. Must match one of the privacyLevelOptions returned by Query Creator Info. Note: unaudited apps (including sandbox apps) are restricted to SELF_ONLY.',
    },
    disableComment: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Disable comments for this post. Defaults to false.',
    },
    autoAddMusic: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Automatically add recommended music to the photo post. Defaults to false.',
    },
    brandContentToggle: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Set to true if the post is a paid partnership promoting a third-party business. Branded content cannot be posted with Only Me privacy.',
    },
    brandOrganicToggle: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: "Set to true if the post is promoting the creator's own business.",
    },
  },

  request: {
    url: () => 'https://open.tiktokapis.com/v2/post/publish/content/init/',
    method: 'POST',
    headers: (params: TikTokDirectPostPhotoParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    }),
    body: (params: TikTokDirectPostPhotoParams) => {
      const photoCoverIndex = resolveTikTokPhotoCoverIndex(
        params.photoImages,
        params.photoCoverIndex
      )

      const postInfo: Record<string, unknown> = {
        brand_content_toggle: params.brandContentToggle ?? false,
        brand_organic_toggle: params.brandOrganicToggle ?? false,
        privacy_level: params.privacyLevel,
      }

      if (params.title) postInfo.title = params.title
      if (params.description) postInfo.description = params.description
      if (params.disableComment !== undefined) postInfo.disable_comment = params.disableComment
      if (params.autoAddMusic !== undefined) postInfo.auto_add_music = params.autoAddMusic
      return {
        media_type: 'PHOTO',
        post_mode: 'DIRECT_POST',
        post_info: postInfo,
        source_info: {
          source: 'PULL_FROM_URL',
          photo_images: params.photoImages,
          photo_cover_index: photoCoverIndex,
        },
      }
    },
  },

  transformResponse: async (response: Response): Promise<TikTokDirectPostPhotoResponse> => {
    const result = await readTikTokPublishInitResponse(response)
    return toTikTokPublishToolResponse(result)
  },

  outputs: {
    publishId: {
      type: 'string',
      description:
        'Unique identifier for tracking the post status. Use this with the Get Post Status tool to check if the photos were successfully published.',
    },
  },
}
