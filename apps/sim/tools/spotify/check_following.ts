import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyCheckFollowingParams {
  accessToken: string
  type: string
  ids: string
}

interface SpotifyCheckFollowingResponse extends ToolResponse {
  output: { results: boolean[] }
}

export const spotifyCheckFollowingTool: ToolConfig<
  SpotifyCheckFollowingParams,
  SpotifyCheckFollowingResponse
> = {
  id: 'spotify_check_following',
  name: 'Spotify Check Following',
  description: 'Check if the user follows artists or users.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-follow-read'],
  },

  params: {
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Type to check: "artist" or "user"',
    },
    ids: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated artist or user IDs (max 50)',
    },
  },

  request: {
    url: (params) => {
      const ids = params.ids
        .split(',')
        .map((id) => id.trim())
        .slice(0, 50)
        .join(',')
      return `https://api.spotify.com/v1/me/following/contains?type=${params.type}&ids=${ids}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response): Promise<SpotifyCheckFollowingResponse> => {
    const results = await response.json()
    return { success: true, output: { results } }
  },

  outputs: {
    results: { type: 'json', description: 'Array of booleans for each ID' },
  },
}
