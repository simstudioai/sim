import type {
  TikTokQueryCreatorInfoParams,
  TikTokQueryCreatorInfoResponse,
} from '@/tools/tiktok/types'
import type { ToolConfig } from '@/tools/types'

export const tiktokQueryCreatorInfoTool: ToolConfig<
  TikTokQueryCreatorInfoParams,
  TikTokQueryCreatorInfoResponse
> = {
  id: 'tiktok_query_creator_info',
  name: 'TikTok Query Creator Info',
  description:
    'Check if the authenticated TikTok user can post content and retrieve their available privacy options, interaction settings, and maximum video duration.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'tiktok',
    requiredScopes: ['video.publish'],
  },

  params: {},

  request: {
    url: () => 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',
    method: 'POST',
    headers: (params: TikTokQueryCreatorInfoParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<TikTokQueryCreatorInfoResponse> => {
    const data = await response.json()

    if (data.error?.code !== 'ok' && data.error?.code) {
      return {
        success: false,
        output: {
          creatorAvatarUrl: null,
          creatorUsername: null,
          creatorNickname: null,
          privacyLevelOptions: [],
          commentDisabled: false,
          duetDisabled: false,
          stitchDisabled: false,
          maxVideoPostDurationSec: null,
        },
        error: data.error?.message || 'Failed to query creator info',
      }
    }

    const creatorInfo = data.data

    if (!creatorInfo) {
      return {
        success: false,
        output: {
          creatorAvatarUrl: null,
          creatorUsername: null,
          creatorNickname: null,
          privacyLevelOptions: [],
          commentDisabled: false,
          duetDisabled: false,
          stitchDisabled: false,
          maxVideoPostDurationSec: null,
        },
        error: 'No creator info returned',
      }
    }

    return {
      success: true,
      output: {
        creatorAvatarUrl: creatorInfo.creator_avatar_url ?? null,
        creatorUsername: creatorInfo.creator_username ?? null,
        creatorNickname: creatorInfo.creator_nickname ?? null,
        privacyLevelOptions: creatorInfo.privacy_level_options ?? [],
        commentDisabled: creatorInfo.comment_disabled ?? false,
        duetDisabled: creatorInfo.duet_disabled ?? false,
        stitchDisabled: creatorInfo.stitch_disabled ?? false,
        maxVideoPostDurationSec: creatorInfo.max_video_post_duration_sec ?? null,
      },
    }
  },

  outputs: {
    creatorAvatarUrl: {
      type: 'string',
      description: 'URL of the creator avatar',
      optional: true,
    },
    creatorUsername: {
      type: 'string',
      description: 'TikTok username of the creator',
      optional: true,
    },
    creatorNickname: {
      type: 'string',
      description: 'Display name/nickname of the creator',
      optional: true,
    },
    privacyLevelOptions: {
      type: 'array',
      description:
        'Available privacy levels for posting (e.g., PUBLIC_TO_EVERYONE, MUTUAL_FOLLOW_FRIENDS, FOLLOWER_OF_CREATOR, SELF_ONLY)',
    },
    commentDisabled: {
      type: 'boolean',
      description: 'Whether the creator has disabled comments by default',
    },
    duetDisabled: {
      type: 'boolean',
      description: 'Whether the creator has disabled duets by default',
    },
    stitchDisabled: {
      type: 'boolean',
      description: 'Whether the creator has disabled stitches by default',
    },
    maxVideoPostDurationSec: {
      type: 'number',
      description: 'Maximum allowed video duration in seconds',
      optional: true,
    },
  },
}
