import type { TikTokGetUserParams, TikTokGetUserResponse } from '@/tools/tiktok/types'
import { TIKTOK_USER_FIELDS } from '@/tools/tiktok/utils'
import type { ToolConfig } from '@/tools/types'

export const tiktokGetUserTool: ToolConfig<TikTokGetUserParams, TikTokGetUserResponse> = {
  id: 'tiktok_get_user',
  name: 'TikTok Get User',
  description:
    'Get the authenticated TikTok user profile information including display name, avatar, bio, follower count, and video statistics.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'tiktok',
    requiredScopes: ['user.info.basic', 'user.info.profile', 'user.info.stats'],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'TikTok OAuth access token',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      default: TIKTOK_USER_FIELDS,
      description:
        'Comma-separated list of fields to return. Available: open_id, union_id, avatar_url, avatar_url_100, avatar_large_url, display_name, bio_description, profile_deep_link, is_verified, username, follower_count, following_count, likes_count, video_count',
    },
  },

  request: {
    url: (params: TikTokGetUserParams) => {
      const fields = params.fields || TIKTOK_USER_FIELDS
      return `https://open.tiktokapis.com/v2/user/info/?fields=${encodeURIComponent(fields)}`
    },
    method: 'GET',
    headers: (params: TikTokGetUserParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<TikTokGetUserResponse> => {
    const data = await response.json()

    if (data.error?.code !== 'ok' && data.error?.code) {
      return {
        success: false,
        output: {
          openId: '',
          unionId: null,
          displayName: '',
          avatarUrl: null,
          avatarUrl100: null,
          avatarLargeUrl: null,
          bioDescription: null,
          profileDeepLink: null,
          isVerified: null,
          username: null,
          followerCount: null,
          followingCount: null,
          likesCount: null,
          videoCount: null,
        },
        error: data.error?.message || 'Failed to fetch user info',
      }
    }

    const user = data.data?.user

    if (!user) {
      return {
        success: false,
        output: {
          openId: '',
          unionId: null,
          displayName: '',
          avatarUrl: null,
          avatarUrl100: null,
          avatarLargeUrl: null,
          bioDescription: null,
          profileDeepLink: null,
          isVerified: null,
          username: null,
          followerCount: null,
          followingCount: null,
          likesCount: null,
          videoCount: null,
        },
        error: 'No user data returned',
      }
    }

    const avatarSourceUrl = user.avatar_large_url ?? user.avatar_url
    const avatarFileName = `${user.username || user.open_id || 'tiktok-user'}-avatar.jpg`

    return {
      success: true,
      output: {
        openId: user.open_id ?? '',
        unionId: user.union_id ?? null,
        displayName: user.display_name ?? '',
        avatarUrl: user.avatar_url ?? null,
        avatarUrl100: user.avatar_url_100 ?? null,
        avatarLargeUrl: user.avatar_large_url ?? null,
        bioDescription: user.bio_description ?? null,
        profileDeepLink: user.profile_deep_link ?? null,
        isVerified: user.is_verified ?? null,
        username: user.username ?? null,
        followerCount: user.follower_count ?? null,
        followingCount: user.following_count ?? null,
        likesCount: user.likes_count ?? null,
        videoCount: user.video_count ?? null,
        ...(avatarSourceUrl && {
          avatarFile: {
            name: avatarFileName,
            mimeType: 'image/jpeg',
            url: avatarSourceUrl,
          },
        }),
      },
    }
  },

  outputs: {
    openId: {
      type: 'string',
      description: 'Unique TikTok user ID for this application',
    },
    unionId: {
      type: 'string',
      description: 'Unique TikTok user ID across all apps from the same developer',
      optional: true,
    },
    displayName: {
      type: 'string',
      description: 'User display name',
    },
    avatarUrl: {
      type: 'string',
      description: 'Profile image URL',
      optional: true,
    },
    avatarUrl100: {
      type: 'string',
      description: 'Profile image URL (100x100)',
      optional: true,
    },
    avatarLargeUrl: {
      type: 'string',
      description: 'Profile image URL (large)',
      optional: true,
    },
    bioDescription: {
      type: 'string',
      description: 'User bio description',
      optional: true,
    },
    profileDeepLink: {
      type: 'string',
      description: 'Deep link to user TikTok profile',
      optional: true,
    },
    isVerified: {
      type: 'boolean',
      description: 'Whether the account is verified',
      optional: true,
    },
    username: {
      type: 'string',
      description: 'TikTok username',
      optional: true,
    },
    followerCount: {
      type: 'number',
      description: 'Number of followers',
      optional: true,
    },
    followingCount: {
      type: 'number',
      description: 'Number of accounts the user follows',
      optional: true,
    },
    likesCount: {
      type: 'number',
      description: 'Total likes received across all videos',
      optional: true,
    },
    videoCount: {
      type: 'number',
      description: 'Total number of public videos',
      optional: true,
    },
    avatarFile: {
      type: 'file',
      description:
        'Downloadable copy of the profile avatar image (largest available variant), stored as a workflow file so it can be chained into file-consuming blocks (e.g. attached to an email).',
      optional: true,
    },
  },
}
