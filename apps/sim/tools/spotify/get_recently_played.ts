import type {
  SpotifyGetRecentlyPlayedParams,
  SpotifyGetRecentlyPlayedResponse,
} from '@/tools/spotify/types'
import { CURRENTLY_PLAYING_TRACK_OUTPUT_PROPERTIES } from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifyGetRecentlyPlayedTool: ToolConfig<
  SpotifyGetRecentlyPlayedParams,
  SpotifyGetRecentlyPlayedResponse
> = {
  id: 'spotify_get_recently_played',
  name: 'Spotify Get Recently Played',
  description: "Get the user's recently played tracks.",
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-read-recently-played'],
  },

  params: {
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 20,
      description: 'Number of tracks to return (1-50)',
    },
    after: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unix timestamp in milliseconds. Returns items after this cursor.',
    },
    before: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unix timestamp in milliseconds. Returns items before this cursor.',
    },
  },

  request: {
    url: (params) => {
      const limit = Math.min(Math.max(params.limit || 20, 1), 50)
      let url = `https://api.spotify.com/v1/me/player/recently-played?limit=${limit}`
      if (params.after) {
        url += `&after=${params.after}`
      }
      if (params.before) {
        url += `&before=${params.before}`
      }
      return url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetRecentlyPlayedResponse> => {
    const data = await response.json()

    const items = (data.items || []).map((item: any) => ({
      played_at: item.played_at,
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
        external_url: item.track.external_urls?.spotify || '',
      },
    }))

    return {
      success: true,
      output: {
        items,
        next: data.next || null,
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Recently played tracks',
      items: {
        type: 'object',
        properties: {
          played_at: { type: 'string', description: 'When the track was played' },
          track: {
            type: 'object',
            description: 'Track information',
            properties: CURRENTLY_PLAYING_TRACK_OUTPUT_PROPERTIES,
          },
        },
      },
    },
    next: { type: 'string', description: 'URL for next page', optional: true },
  },
}
