import type {
  TikTokDirectPostVideoParams,
  TikTokDirectPostVideoResponse,
} from '@/tools/tiktok/types'
import { readTikTokPublishInitResponse, toTikTokPublishToolResponse } from '@/tools/tiktok/utils'
import type { ToolConfig } from '@/tools/types'

function buildPostInfo(params: TikTokDirectPostVideoParams): Record<string, unknown> {
  const postInfo: Record<string, unknown> = {
    brand_content_toggle: params.brandContentToggle,
    brand_organic_toggle: params.brandOrganicToggle ?? false,
    privacy_level: params.privacyLevel,
    disable_duet: params.disableDuet,
    disable_stitch: params.disableStitch,
    disable_comment: params.disableComment,
  }

  if (params.title) postInfo.title = params.title
  if (params.videoCoverTimestampMs !== undefined) {
    postInfo.video_cover_timestamp_ms = params.videoCoverTimestampMs
  }
  if (params.isAigc !== undefined) postInfo.is_aigc = params.isAigc
  return postInfo
}

export const tiktokDirectPostVideoTool: ToolConfig<
  TikTokDirectPostVideoParams,
  TikTokDirectPostVideoResponse
> = {
  id: 'tiktok_direct_post_video',
  name: 'TikTok Direct Post Video',
  description:
    'Publish a video to TikTok by uploading a file from the workflow. Rate limit: 6 requests per minute per user.',
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
    file: {
      type: 'file',
      required: true,
      visibility: 'user-only',
      description: 'Video file to upload from the workflow. Maximum size: 250 MB.',
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
        'Privacy level for the video. Options: PUBLIC_TO_EVERYONE, MUTUAL_FOLLOW_FRIENDS, FOLLOWER_OF_CREATOR, SELF_ONLY. Must match one of the privacyLevelOptions returned by Query Creator Info. Note: unaudited apps (including sandbox apps) are restricted to SELF_ONLY.',
    },
    disableDuet: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether to disable duet for this video. The user must choose explicitly.',
    },
    disableStitch: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether to disable stitch for this video. The user must choose explicitly.',
    },
    disableComment: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether to disable comments for this video. The user must choose explicitly.',
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
    brandContentToggle: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Whether the video is a paid partnership promoting a third-party business. The user must choose explicitly. Branded content cannot be posted with Only Me privacy.',
    },
    brandOrganicToggle: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: "Set to true if the video is promoting the creator's own business.",
    },
    musicUsageConsent: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        "Must be 'accepted' after the user explicitly agrees to TikTok's Music Usage Confirmation.",
    },
  },

  request: {
    url: () => '/api/tools/tiktok/publish-video',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: TikTokDirectPostVideoParams) => {
      const postInfo = buildPostInfo(params)

      return {
        accessToken: params.accessToken,
        mode: 'direct',
        file: params.file,
        postInfo,
        musicUsageConsent: params.musicUsageConsent,
      }
    },
  },

  transformResponse: async (response: Response): Promise<TikTokDirectPostVideoResponse> => {
    const result = await readTikTokPublishInitResponse(response)
    return toTikTokPublishToolResponse(result)
  },

  outputs: {
    publishId: {
      type: 'string',
      description:
        'Unique identifier for tracking the post status. Use this with the Get Post Status tool to check if the video was successfully published.',
    },
  },
}
