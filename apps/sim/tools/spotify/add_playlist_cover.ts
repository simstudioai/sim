import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyAddPlaylistCoverParams {
  accessToken: string
  playlistId: string
  imageBase64: string
}

interface SpotifyAddPlaylistCoverResponse extends ToolResponse {
  output: { success: boolean }
}

export const spotifyAddPlaylistCoverTool: ToolConfig<
  SpotifyAddPlaylistCoverParams,
  SpotifyAddPlaylistCoverResponse
> = {
  id: 'spotify_add_playlist_cover',
  name: 'Spotify Add Playlist Cover',
  description: 'Upload a custom cover image for a playlist. Image must be JPEG and under 256KB.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['playlist-modify-public', 'playlist-modify-private', 'ugc-image-upload'],
  },

  params: {
    playlistId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Spotify playlist ID',
    },
    imageBase64: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Base64-encoded JPEG image data (max 256KB)',
    },
  },

  request: {
    url: (params) => `https://api.spotify.com/v1/playlists/${params.playlistId}/images`,
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'image/jpeg',
    }),
    body: (params) => params.imageBase64,
  },

  transformResponse: async (): Promise<SpotifyAddPlaylistCoverResponse> => {
    return { success: true, output: { success: true } }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether upload succeeded' },
  },
}
