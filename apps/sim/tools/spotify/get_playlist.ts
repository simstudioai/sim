import type { SpotifyGetPlaylistParams, SpotifyGetPlaylistResponse } from '@/tools/spotify/types'
import { PLAYLIST_OWNER_OUTPUT_PROPERTIES } from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifyGetPlaylistTool: ToolConfig<
  SpotifyGetPlaylistParams,
  SpotifyGetPlaylistResponse
> = {
  id: 'spotify_get_playlist',
  name: 'Spotify Get Playlist',
  description: 'Get detailed information about a playlist on Spotify by its ID.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
  },

  params: {
    playlistId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Spotify ID of the playlist',
    },
    market: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 3166-1 alpha-2 country code for track availability (e.g., "US", "GB")',
    },
  },

  request: {
    url: (params) => {
      let url = `https://api.spotify.com/v1/playlists/${params.playlistId}`
      if (params.market) {
        url += `?market=${params.market}`
      }
      return url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetPlaylistResponse> => {
    const playlist = await response.json()

    return {
      success: true,
      output: {
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        public: playlist.public,
        collaborative: playlist.collaborative,
        owner: {
          id: playlist.owner?.id || '',
          display_name: playlist.owner?.display_name || '',
        },
        image_url: playlist.images?.[0]?.url || null,
        total_tracks: playlist.tracks?.total || 0,
        snapshot_id: playlist.snapshot_id,
        external_url: playlist.external_urls?.spotify || '',
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Spotify playlist ID' },
    name: { type: 'string', description: 'Playlist name' },
    description: { type: 'string', description: 'Playlist description', optional: true },
    public: { type: 'boolean', description: 'Whether the playlist is public' },
    collaborative: { type: 'boolean', description: 'Whether the playlist is collaborative' },
    owner: {
      type: 'object',
      description: 'Playlist owner information',
      properties: PLAYLIST_OWNER_OUTPUT_PROPERTIES,
    },
    image_url: { type: 'string', description: 'Playlist cover image URL', optional: true },
    total_tracks: { type: 'number', description: 'Total number of tracks' },
    snapshot_id: { type: 'string', description: 'Playlist snapshot ID for versioning' },
    external_url: { type: 'string', description: 'Spotify URL' },
  },
}
