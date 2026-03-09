import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyGetPlaylistCoverParams {
  accessToken: string
  playlistId: string
}

interface SpotifyGetPlaylistCoverResponse extends ToolResponse {
  output: {
    images: Array<{
      url: string
      width: number | null
      height: number | null
    }>
  }
}

export const spotifyGetPlaylistCoverTool: ToolConfig<
  SpotifyGetPlaylistCoverParams,
  SpotifyGetPlaylistCoverResponse
> = {
  id: 'spotify_get_playlist_cover',
  name: 'Spotify Get Playlist Cover',
  description: "Get a playlist's cover image.",
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['playlist-read-private'],
  },

  params: {
    playlistId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Spotify playlist ID',
    },
  },

  request: {
    url: (params) => `https://api.spotify.com/v1/playlists/${params.playlistId}/images`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetPlaylistCoverResponse> => {
    const images = await response.json()
    return {
      success: true,
      output: {
        images: (images || []).map((img: any) => ({
          url: img.url,
          width: img.width || null,
          height: img.height || null,
        })),
      },
    }
  },

  outputs: {
    images: { type: 'json', description: 'List of cover images' },
  },
}
