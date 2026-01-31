import type {
  SpotifyGetSavedTracksParams,
  SpotifyGetSavedTracksResponse,
} from '@/tools/spotify/types'
import { TRACK_LIST_OUTPUT_PROPERTIES } from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifyGetSavedTracksTool: ToolConfig<
  SpotifyGetSavedTracksParams,
  SpotifyGetSavedTracksResponse
> = {
  id: 'spotify_get_saved_tracks',
  name: 'Spotify Get Saved Tracks',
  description: "Get the current user's saved/liked tracks from their library.",
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-library-read'],
  },

  params: {
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 20,
      description: 'Number of tracks to return (1-50)',
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
      description: 'ISO 3166-1 alpha-2 country code (e.g., "US", "GB")',
    },
  },

  request: {
    url: (params) => {
      const limit = Math.min(Math.max(params.limit || 20, 1), 50)
      const offset = params.offset || 0
      let url = `https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`
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

  transformResponse: async (response): Promise<SpotifyGetSavedTracksResponse> => {
    const data = await response.json()

    const tracks = (data.items || []).map((item: any) => ({
      added_at: item.added_at,
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
      description: "User's saved tracks",
      items: {
        type: 'object',
        properties: {
          added_at: { type: 'string', description: 'When the track was saved' },
          track: {
            type: 'object',
            description: 'Track information',
            properties: TRACK_LIST_OUTPUT_PROPERTIES,
          },
        },
      },
    },
    total: { type: 'number', description: 'Total number of saved tracks' },
    next: { type: 'string', description: 'URL for next page', optional: true },
  },
}
