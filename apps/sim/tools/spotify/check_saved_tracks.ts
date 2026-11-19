import type {
  SpotifyCheckSavedTracksParams,
  SpotifyCheckSavedTracksResponse,
} from '@/tools/spotify/types'
import {
  readSpotifyLibraryChecks,
  splitSpotifyLibraryIds,
  spotifyLibraryUrl,
} from '@/tools/spotify/utils'
import type { ToolConfig } from '@/tools/types'

export const spotifyCheckSavedTracksTool: ToolConfig<
  SpotifyCheckSavedTracksParams,
  SpotifyCheckSavedTracksResponse
> = {
  id: 'spotify_check_saved_tracks',
  name: 'Spotify Check Saved Tracks',
  description: "Check if one or more tracks are saved in the user's library.",
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-library-read'],
  },

  params: {
    trackIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated track IDs to check (max 50)',
    },
  },

  request: {
    url: (params) => spotifyLibraryUrl(params.trackIds, 'track', { contains: true, maxIds: 50 }),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (
    response,
    params,
    context
  ): Promise<SpotifyCheckSavedTracksResponse> => {
    const data = await readSpotifyLibraryChecks(
      response,
      params && { params, ids: params.trackIds, type: 'track', maxIds: 50 },
      context?.signal
    )
    const ids = splitSpotifyLibraryIds(params?.trackIds || '', 50)

    const results = ids.map((id, index) => ({
      id,
      saved: data[index] || false,
    }))

    return {
      success: true,
      output: {
        results,
        all_saved: data.every((saved: boolean) => saved),
        none_saved: data.every((saved: boolean) => !saved),
      },
    }
  },

  outputs: {
    results: { type: 'json', description: 'Array of track IDs with saved status' },
    all_saved: { type: 'boolean', description: 'Whether all tracks are saved' },
    none_saved: { type: 'boolean', description: 'Whether no tracks are saved' },
  },
}
