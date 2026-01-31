import type {
  SpotifyGetPlaylistTracksParams,
  SpotifyGetPlaylistTracksResponse,
} from '@/tools/spotify/types'
import { TRACK_LIST_OUTPUT_PROPERTIES } from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifyGetPlaylistTracksTool: ToolConfig<
  SpotifyGetPlaylistTracksParams,
  SpotifyGetPlaylistTracksResponse
> = {
  id: 'spotify_get_playlist_tracks',
  name: 'Spotify Get Playlist Tracks',
  description: 'Get the tracks in a Spotify playlist.',
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
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 50,
      description: 'Maximum number of tracks to return (1-100)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 0,
      description: 'Index of the first track to return for pagination',
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
      const limit = Math.min(Math.max(params.limit || 50, 1), 100)
      const offset = params.offset || 0
      let url = `https://api.spotify.com/v1/playlists/${params.playlistId}/tracks?limit=${limit}&offset=${offset}`
      if (params.market) {
        url += `&market=${params.market}`
      }
      return url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetPlaylistTracksResponse> => {
    const data = await response.json()

    const tracks = (data.items || [])
      .filter((item: any) => item.track !== null)
      .map((item: any) => ({
        added_at: item.added_at,
        added_by: item.added_by?.id || '',
        track: {
          id: item.track.id,
          name: item.track.name,
          artists: item.track.artists?.map((a: any) => ({ id: a.id, name: a.name })) || [],
          album: {
            id: item.track.album?.id || '',
            name: item.track.album?.name || '',
            image_url: item.track.album?.images?.[0]?.url || null,
          },
          duration_ms: item.track.duration_ms,
          popularity: item.track.popularity,
          external_url: item.track.external_urls?.spotify || '',
        },
      }))

    return {
      success: true,
      output: {
        tracks,
        total: data.total || tracks.length,
        next: data.next || null,
      },
    }
  },

  outputs: {
    tracks: {
      type: 'array',
      description: 'List of tracks in the playlist',
      items: {
        type: 'object',
        properties: {
          added_at: { type: 'string', description: 'When the track was added' },
          added_by: { type: 'string', description: 'User ID who added the track' },
          track: {
            type: 'object',
            description: 'Track information',
            properties: TRACK_LIST_OUTPUT_PROPERTIES,
          },
        },
      },
    },
    total: { type: 'number', description: 'Total number of tracks in playlist' },
    next: { type: 'string', description: 'URL for next page of results', optional: true },
  },
}
