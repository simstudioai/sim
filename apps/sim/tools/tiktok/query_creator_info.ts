import { tiktokCreatorInfoApiDataSchema } from '@/tools/tiktok/api-schemas'
import type {
  TikTokQueryCreatorInfoParams,
  TikTokQueryCreatorInfoResponse,
} from '@/tools/tiktok/types'
import { readTikTokApiResponse } from '@/tools/tiktok/utils'
import type { ToolConfig } from '@/tools/types'

function emptyCreatorInfoOutput(): TikTokQueryCreatorInfoResponse['output'] {
  return {
    creatorAvatarUrl: null,
    creatorUsername: null,
    creatorNickname: null,
    privacyLevelOptions: [],
    commentDisabled: false,
    duetDisabled: false,
    stitchDisabled: false,
    maxVideoPostDurationSec: null,
  }
}

export const tiktokQueryCreatorInfoTool: ToolConfig<
  TikTokQueryCreatorInfoParams,
  TikTokQueryCreatorInfoResponse
> = {
  id: 'tiktok_query_creator_info',
  name: 'TikTok Query Creator Info',
  description:
    "Inspect the authenticated creator's privacy options, interaction settings, and maximum video duration.",
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
  },

  request: {
    url: () => 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',
    method: 'POST',
    headers: (params: TikTokQueryCreatorInfoParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    }),
    body: () => ({}),
  },

  transformResponse: async (response: Response): Promise<TikTokQueryCreatorInfoResponse> => {
    const { data: creatorInfo, error } = await readTikTokApiResponse(
      response,
      tiktokCreatorInfoApiDataSchema
    )

    if (error) {
      return {
        success: false,
        output: emptyCreatorInfoOutput(),
        error: error.message || 'Failed to query creator info',
      }
    }

    if (!creatorInfo) {
      return {
        success: false,
        output: emptyCreatorInfoOutput(),
        error: 'No creator info returned',
      }
    }

    return {
      success: true,
      output: {
        creatorAvatarUrl: creatorInfo.creator_avatar_url ?? null,
        ...(creatorInfo.creator_avatar_url && {
          creatorAvatarFile: {
            name: `${creatorInfo.creator_username || 'tiktok-creator'}-avatar.jpg`,
            mimeType: 'image/jpeg',
            url: creatorInfo.creator_avatar_url,
          },
        }),
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
      description:
        'Temporary URL of the current creator avatar. TikTok documents this URL as expiring two hours after it is returned.',
      optional: true,
    },
    creatorAvatarFile: {
      type: 'file',
      description:
        'Durable workflow-file copy of the current creator avatar, suitable for chaining into file-consuming blocks such as email attachments.',
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
      items: {
        type: 'string',
        description: 'Privacy level currently available to the authenticated creator',
      },
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
