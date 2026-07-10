import type {
  InstagramGetProfileParams,
  InstagramGetProfileResponse,
} from '@/tools/instagram/types'
import { bearerHeaders, graphUrl, readGraphError } from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

const PROFILE_FIELDS =
  'user_id,id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count'

export const instagramGetProfileTool: ToolConfig<
  InstagramGetProfileParams,
  InstagramGetProfileResponse
> = {
  id: 'instagram_get_profile',
  name: 'Instagram Get Profile',
  description: 'Get the connected Instagram professional account profile',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'instagram',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Instagram API',
    },
  },

  request: {
    url: () => graphUrl('/me', { fields: PROFILE_FIELDS }),
    method: 'GET',
    headers: (params) => bearerHeaders(params.accessToken),
  },

  transformResponse: async (response): Promise<InstagramGetProfileResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: {
          userId: null,
          id: null,
          username: null,
          name: null,
          accountType: null,
          profilePictureUrl: null,
          followersCount: null,
          followsCount: null,
          mediaCount: null,
        },
        error: await readGraphError(response),
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        userId: data.user_id ?? null,
        id: data.id ?? null,
        username: data.username ?? null,
        name: data.name ?? null,
        accountType: data.account_type ?? null,
        profilePictureUrl: data.profile_picture_url ?? null,
        followersCount: data.followers_count ?? null,
        followsCount: data.follows_count ?? null,
        mediaCount: data.media_count ?? null,
      },
    }
  },

  outputs: {
    userId: {
      type: 'string',
      description: 'Instagram professional account user_id',
      optional: true,
    },
    id: { type: 'string', description: 'Graph object id', optional: true },
    username: { type: 'string', description: 'Instagram username', optional: true },
    name: { type: 'string', description: 'Display name', optional: true },
    accountType: { type: 'string', description: 'Business or Media_Creator', optional: true },
    profilePictureUrl: { type: 'string', description: 'Profile picture URL', optional: true },
    followersCount: { type: 'number', description: 'Follower count', optional: true },
    followsCount: { type: 'number', description: 'Following count', optional: true },
    mediaCount: { type: 'number', description: 'Media count', optional: true },
  },
}
