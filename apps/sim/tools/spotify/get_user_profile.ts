import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyGetUserProfileParams {
  accessToken: string
  userId: string
}

interface SpotifyGetUserProfileResponse extends ToolResponse {
  output: {
    id: string
    display_name: string | null
    followers: number
    image_url: string | null
    external_url: string
  }
}

export const spotifyGetUserProfileTool: ToolConfig<
  SpotifyGetUserProfileParams,
  SpotifyGetUserProfileResponse
> = {
  id: 'spotify_get_user_profile',
  name: 'Spotify Get User Profile',
  description: "Get a user's public profile.",
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-read-private'],
  },

  params: {
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Spotify user ID',
    },
  },

  request: {
    url: (params) => `https://api.spotify.com/v1/users/${params.userId}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetUserProfileResponse> => {
    const user = await response.json()
    return {
      success: true,
      output: {
        id: user.id,
        display_name: user.display_name || null,
        followers: user.followers?.total || 0,
        image_url: user.images?.[0]?.url || null,
        external_url: user.external_urls?.spotify || '',
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'User ID' },
    display_name: { type: 'string', description: 'Display name' },
    followers: { type: 'number', description: 'Number of followers' },
    image_url: { type: 'string', description: 'Profile image URL' },
    external_url: { type: 'string', description: 'Spotify URL' },
  },
}
