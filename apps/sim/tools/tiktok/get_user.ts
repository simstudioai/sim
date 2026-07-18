import { tiktokGetUserApiDataSchema } from '@/tools/tiktok/api-schemas'
import type { TikTokGetUserParams, TikTokGetUserResponse } from '@/tools/tiktok/types'
import {
  readTikTokApiResponse,
  TIKTOK_USER_FIELD_NAMES,
  TIKTOK_USER_FIELDS,
} from '@/tools/tiktok/utils'
import type { ToolConfig } from '@/tools/types'

const REQUIRED_USER_FIELDS = ['open_id', 'display_name'] as const
const USER_FIELD_ALLOWLIST = new Set<string>(TIKTOK_USER_FIELD_NAMES)
const USER_FIELD_ALIASES: Record<string, string> = {
  openId: 'open_id',
  unionId: 'union_id',
  avatarUrl: 'avatar_url',
  avatarLargeUrl: 'avatar_large_url',
  displayName: 'display_name',
  bioDescription: 'bio_description',
  profileDeepLink: 'profile_deep_link',
  isVerified: 'is_verified',
  followerCount: 'follower_count',
  followingCount: 'following_count',
  likesCount: 'likes_count',
  videoCount: 'video_count',
}

function resolveUserFields(fields: string | undefined): string {
  if (!fields?.trim()) return TIKTOK_USER_FIELDS

  const requested = fields
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean)
    .map((field) => USER_FIELD_ALIASES[field] ?? field)
  const invalid = requested.filter((field) => !USER_FIELD_ALLOWLIST.has(field))
  if (invalid.length > 0) {
    throw new Error(`Unsupported TikTok user field(s): ${[...new Set(invalid)].join(', ')}`)
  }

  return [...new Set([...REQUIRED_USER_FIELDS, ...requested])].join(',')
}

function emptyUserOutput(): TikTokGetUserResponse['output'] {
  return {
    openId: '',
    unionId: null,
    displayName: '',
    bioDescription: null,
    profileDeepLink: null,
    isVerified: null,
    username: null,
    followerCount: null,
    followingCount: null,
    likesCount: null,
    videoCount: null,
  }
}

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
        'Comma-separated allowlisted fields to return. open_id and display_name are always included. Available: open_id, union_id, avatar_url, avatar_large_url, display_name, bio_description, profile_deep_link, is_verified, username, follower_count, following_count, likes_count, video_count. Include avatar_url or avatar_large_url to receive avatarFile.',
    },
  },

  request: {
    url: (params: TikTokGetUserParams) => {
      const fields = resolveUserFields(params.fields)
      return `https://open.tiktokapis.com/v2/user/info/?fields=${encodeURIComponent(fields)}`
    },
    method: 'GET',
    headers: (params: TikTokGetUserParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response): Promise<TikTokGetUserResponse> => {
    const { data, error } = await readTikTokApiResponse(response, tiktokGetUserApiDataSchema)

    if (error) {
      return {
        success: false,
        output: emptyUserOutput(),
        error: error.message || 'Failed to fetch user info',
      }
    }

    const user = data?.user

    if (!user) {
      return {
        success: false,
        output: emptyUserOutput(),
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
