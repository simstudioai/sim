import type {
  SpotifyGetCurrentUserParams,
  SpotifyGetCurrentUserResponse,
} from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifyGetCurrentUserTool: ToolConfig<
  SpotifyGetCurrentUserParams,
  SpotifyGetCurrentUserResponse
> = {
  id: 'spotify_get_current_user',
  name: 'Spotify Get Current User',
  description: "Get the current user's Spotify profile information.",
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-read-private', 'user-read-email'],
  },

  params: {},

  request: {
    url: () => 'https://api.spotify.com/v1/me',
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetCurrentUserResponse> => {
    const user = await response.json()

    return {
      success: true,
      output: {
        id: user.id,
        display_name: user.display_name || '',
        email: user.email || null,
        country: user.country || null,
        product: user.product || null,
        followers: user.followers?.total || 0,
        image_url: user.images?.[0]?.url || null,
        external_url: user.external_urls?.spotify || '',
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Spotify user ID' },
    display_name: { type: 'string', description: 'Display name' },
    email: { type: 'string', description: 'Email address', optional: true },
    country: { type: 'string', description: 'Country code', optional: true },
    product: { type: 'string', description: 'Subscription level (free, premium)', optional: true },
    followers: { type: 'number', description: 'Number of followers' },
    image_url: { type: 'string', description: 'Profile image URL', optional: true },
    external_url: { type: 'string', description: 'Spotify profile URL' },
  },
}
