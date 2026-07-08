import type {
  TikTokDirectPostVideoParams,
  TikTokDirectPostVideoResponse,
} from '@/tools/tiktok/types'
import { parsePublishInitResponse } from '@/tools/tiktok/utils'
import type { ToolConfig } from '@/tools/types'

function buildPostInfo(params: TikTokDirectPostVideoParams): Record<string, unknown> {
  const postInfo: Record<string, unknown> = {
    privacy_level: params.privacyLevel,
  }

  if (params.title) postInfo.title = params.title
  if (params.disableDuet !== undefined) postInfo.disable_duet = params.disableDuet
  if (params.disableStitch !== undefined) postInfo.disable_stitch = params.disableStitch
  if (params.disableComment !== undefined) postInfo.disable_comment = params.disableComment
  if (params.videoCoverTimestampMs !== undefined) {
    postInfo.video_cover_timestamp_ms = params.videoCoverTimestampMs
  }
  if (params.isAigc !== undefined) postInfo.is_aigc = params.isAigc
  if (params.brandContentToggle !== undefined) {
    postInfo.brand_content_toggle = params.brandContentToggle
  }
  if (params.brandOrganicToggle !== undefined) {
    postInfo.brand_organic_toggle = params.brandOrganicToggle
  }

  return postInfo
}

export const tiktokDirectPostVideoTool: ToolConfig<
  TikTokDirectPostVideoParams,
  TikTokDirectPostVideoResponse
> = {
  id: 'tiktok_direct_post_video',
  name: 'TikTok Direct Post Video',
  description:
    'Publish a video to TikTok, either by public URL (TikTok fetches it) or by uploading a file from the workflow. Rate limit: 6 requests per minute per user.',
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
    source: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: "Media transfer method: 'PULL_FROM_URL' or 'FILE_UPLOAD'.",
    },
    videoUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Public URL of the video to post (used when source is PULL_FROM_URL). The domain/URL prefix must be verified in the TikTok developer portal.',
    },
    file: {
      type: 'file',
      required: false,
      visibility: 'user-only',
      description: 'Video file to upload from the workflow (used when source is FILE_UPLOAD).',
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
    brandContentToggle: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Set to true if the video is a paid partnership promoting a third-party business. Branded content cannot be posted with Only Me privacy.',
    },
    brandOrganicToggle: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: "Set to true if the video is promoting the creator's own business.",
    },
  },

  request: {
    url: (params: TikTokDirectPostVideoParams) =>
      params.source === 'FILE_UPLOAD'
        ? '/api/tools/tiktok/publish-video'
        : 'https://open.tiktokapis.com/v2/post/publish/video/init/',
    method: 'POST',
    headers: (params: TikTokDirectPostVideoParams) => ({
      ...(params.source !== 'FILE_UPLOAD' && { Authorization: `Bearer ${params.accessToken}` }),
      'Content-Type':
        params.source === 'FILE_UPLOAD' ? 'application/json' : 'application/json; charset=UTF-8',
    }),
    body: (params: TikTokDirectPostVideoParams) => {
      const postInfo = buildPostInfo(params)

      if (params.source === 'FILE_UPLOAD') {
        return {
          accessToken: params.accessToken,
          mode: 'direct',
          file: params.file,
          postInfo,
        }
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
    const result = parsePublishInitResponse(data)

    if (!result.success) {
      return {
        success: false,
        output: { publishId: '' },
        error: result.error,
      }
    }

    return {
      success: true,
      output: { publishId: result.publishId },
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
