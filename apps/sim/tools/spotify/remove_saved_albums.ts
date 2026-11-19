import { spotifyLibraryUrl } from '@/tools/spotify/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyRemoveSavedAlbumsParams {
  accessToken: string
  albumIds: string
}

interface SpotifyRemoveSavedAlbumsResponse extends ToolResponse {
  output: { success: boolean }
}

export const spotifyRemoveSavedAlbumsTool: ToolConfig<
  SpotifyRemoveSavedAlbumsParams,
  SpotifyRemoveSavedAlbumsResponse
> = {
  id: 'spotify_remove_saved_albums',
  name: 'Spotify Remove Saved Albums',
  description: "Remove albums from the user's library.",
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-library-modify'],
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
    url: (params) => spotifyLibraryUrl(params.albumIds, 'album', { maxIds: 20 }),
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (): Promise<SpotifyRemoveSavedAlbumsResponse> => {
    return { success: true, output: { success: true } }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether albums were removed' },
  },
}
