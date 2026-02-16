import type {
  TikTokDirectPostVideoParams,
  TikTokDirectPostVideoResponse,
} from '@/tools/tiktok/types'
import type { ToolConfig } from '@/tools/types'

export const tiktokDirectPostVideoTool: ToolConfig<
  TikTokDirectPostVideoParams,
  TikTokDirectPostVideoResponse
> = {
  id: 'tiktok_direct_post_video',
  name: 'TikTok Direct Post Video',
  description:
    'Publish a video to TikTok from a public URL. TikTok will fetch the video from the provided URL and post it to the authenticated user account. Rate limit: 6 requests per minute per user.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'tiktok',
    requiredScopes: ['video.publish'],
  },

  params: {
    videoUrl: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Public URL of the video to post. Must be accessible by TikTok servers.',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Video caption/description. Maximum 2200 characters.',
    },
    privacyLevel: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Privacy level for the video. Options: PUBLIC_TO_EVERYONE, MUTUAL_FOLLOW_FRIENDS, FOLLOWER_OF_CREATOR, SELF_ONLY. Note: Unaudited apps may be restricted to SELF_ONLY.',
    },
    disableDuet: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Disable duet for this video. Defaults to false.',
    },
    disableStitch: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Disable stitch for this video. Defaults to false.',
    },
    disableComment: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Disable comments for this video. Defaults to false.',
    },
    videoCoverTimestampMs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Timestamp in milliseconds to use as the video cover image.',
    },
    isAigc: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to true if the video is AI-generated content (AIGC).',
    },
  },

  request: {
    url: () => 'https://open.tiktokapis.com/v2/post/publish/video/init/',
    method: 'POST',
    headers: (params: TikTokDirectPostVideoParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    }),
    body: (params: TikTokDirectPostVideoParams) => {
      const postInfo: Record<string, unknown> = {
        privacy_level: params.privacyLevel,
      }

      if (params.title) {
        postInfo.title = params.title
      }
      if (params.disableDuet !== undefined) {
        postInfo.disable_duet = params.disableDuet === true || params.disableDuet === 'true'
      }
      if (params.disableStitch !== undefined) {
        postInfo.disable_stitch = params.disableStitch === true || params.disableStitch === 'true'
      }
      if (params.disableComment !== undefined) {
        postInfo.disable_comment = params.disableComment === true || params.disableComment === 'true'
      }
      if (params.videoCoverTimestampMs !== undefined) {
        postInfo.video_cover_timestamp_ms = params.videoCoverTimestampMs
      }
      if (params.isAigc !== undefined) {
        postInfo.is_aigc = params.isAigc
      }

      return {
        post_info: postInfo,
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: params.videoUrl,
        },
      }
    },
  },

  transformResponse: async (response: Response): Promise<TikTokDirectPostVideoResponse> => {
    const data = await response.json()

    if (data.error?.code !== 'ok' && data.error?.code) {
      return {
        success: false,
        output: {
          publishId: '',
        },
        error: data.error?.message || 'Failed to initiate video post',
      }
    }

    const publishId = data.data?.publish_id

    if (!publishId) {
      return {
        success: false,
        output: {
          publishId: '',
        },
        error: 'No publish ID returned',
      }
    }

    return {
      success: true,
      output: {
        publishId: publishId,
      },
    }
  },

  outputs: {
    publishId: {
      type: 'string',
      description:
        'Unique identifier for tracking the post status. Use this with the Get Post Status tool to check if the video was successfully published.',
    },
  },
}
