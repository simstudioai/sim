import type {
  SpotifyGetUserPlaylistsParams,
  SpotifyGetUserPlaylistsResponse,
} from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifyGetUserPlaylistsTool: ToolConfig<
  SpotifyGetUserPlaylistsParams,
  SpotifyGetUserPlaylistsResponse
> = {
  id: 'spotify_get_user_playlists',
  name: 'Spotify Get User Playlists',
  description: "Get the current user's playlists on Spotify.",
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['playlist-read-private', 'playlist-read-collaborative'],
  },

  params: {
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 20,
      description: 'Maximum number of playlists to return (1-50)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 0,
      description: 'Index of the first playlist to return for pagination',
    },
  },

  request: {
    url: (params) => {
      const limit = Math.min(Math.max(params.limit || 20, 1), 50)
      const offset = params.offset || 0
      return `https://api.spotify.com/v1/me/playlists?limit=${limit}&offset=${offset}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetUserPlaylistsResponse> => {
    const data = await response.json()

    const playlists = (data.items || []).map((playlist: any) => ({
      id: playlist.id,
      name: playlist.name,
      description: playlist.description,
      public: playlist.public,
      collaborative: playlist.collaborative,
      owner: playlist.owner?.display_name || '',
      total_tracks: playlist.tracks?.total || 0,
      image_url: playlist.images?.[0]?.url || null,
      external_url: playlist.external_urls?.spotify || '',
    }))

    return {
      success: true,
      output: {
        playlists,
        total: data.total || playlists.length,
        next: data.next || null,
      },
    }
  },

  outputs: {
    playlists: {
      type: 'array',
      description: "User's playlists",
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Spotify playlist ID' },
          name: { type: 'string', description: 'Playlist name' },
          description: { type: 'string', description: 'Playlist description' },
          public: { type: 'boolean', description: 'Whether public' },
          collaborative: { type: 'boolean', description: 'Whether collaborative' },
          owner: { type: 'string', description: 'Owner display name' },
          total_tracks: { type: 'number', description: 'Number of tracks' },
          image_url: { type: 'string', description: 'Cover image URL' },
          external_url: { type: 'string', description: 'Spotify URL' },
        },
      },
    },
    total: { type: 'number', description: 'Total number of playlists' },
    next: { type: 'string', description: 'URL for next page', optional: true },
  },
}
