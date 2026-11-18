import { readSpotifyLibraryCheck, spotifyLibraryUrl } from '@/tools/spotify/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyCheckSavedAlbumsParams {
  accessToken: string
  albumIds: string
}

interface SpotifyCheckSavedAlbumsResponse extends ToolResponse {
  output: { results: boolean[] }
}

export const spotifyCheckSavedAlbumsTool: ToolConfig<
  SpotifyCheckSavedAlbumsParams,
  SpotifyCheckSavedAlbumsResponse
> = {
  id: 'spotify_check_saved_albums',
  name: 'Spotify Check Saved Albums',
  description: 'Check if albums are saved in library.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-library-read'],
  },

  params: {
    albumIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated album IDs (max 20)',
    },
  },

  request: {
    url: (params) => spotifyLibraryUrl(params.albumIds, 'album', { contains: true, maxIds: 20 }),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response): Promise<SpotifyCheckSavedAlbumsResponse> => {
    const results = await readSpotifyLibraryCheck(response)
    return { success: true, output: { results } }
  },

  outputs: {
    results: { type: 'json', description: 'Array of booleans for each album' },
  },
}
