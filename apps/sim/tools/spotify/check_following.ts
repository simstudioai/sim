import { readSpotifyLibraryChecks, spotifyLibraryUrl } from '@/tools/spotify/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyCheckFollowingParams {
  accessToken: string
  type: string
  ids: string
}

interface SpotifyCheckFollowingResponse extends ToolResponse {
  output: { results: boolean[] }
}

/** The library URI type for `type`, rejecting anything other than `artist` or `user`. */
function followType(type: string): 'artist' | 'user' {
  const normalized = String(type ?? '')
    .trim()
    .toLowerCase()
  if (normalized === 'artist' || normalized === 'user') return normalized
  throw new Error('Type must be "artist" or "user"')
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
    url: (params) =>
      spotifyLibraryUrl(params.ids, followType(params.type), {
        contains: true,
        maxIds: 50,
      }),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response, params, context): Promise<SpotifyCheckFollowingResponse> => {
    const results = await readSpotifyLibraryChecks(
      response,
      params && { params, ids: params.ids, type: followType(params.type), maxIds: 50 },
      context?.signal
    )
    return { success: true, output: { results } }
  },

  outputs: {
    results: { type: 'json', description: 'Array of booleans for each ID' },
  },
}
