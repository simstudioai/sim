import type {
  SpotifyRemoveTracksFromPlaylistParams,
  SpotifyRemoveTracksFromPlaylistResponse,
} from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifyRemoveTracksFromPlaylistTool: ToolConfig<
  SpotifyRemoveTracksFromPlaylistParams,
  SpotifyRemoveTracksFromPlaylistResponse
> = {
  id: 'spotify_remove_tracks_from_playlist',
  name: 'Spotify Remove Tracks from Playlist',
  description: 'Remove one or more tracks from a Spotify playlist.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['playlist-modify-public', 'playlist-modify-private'],
  },

  params: {
    playlistId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Spotify ID of the playlist',
    },
    uris: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma-separated Spotify URIs to remove (e.g., "spotify:track:xxx,spotify:track:yyy")',
    },
  },

  request: {
    url: (params) => `https://api.spotify.com/v1/playlists/${params.playlistId}/tracks`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const uris = params.uris.split(',').map((uri) => ({ uri: uri.trim() }))
      return { tracks: uris }
    },
  },

  transformResponse: async (response): Promise<SpotifyRemoveTracksFromPlaylistResponse> => {
    const data = await response.json()

    return {
      success: true,
      output: {
        snapshot_id: data.snapshot_id,
      },
    }
  },

  outputs: {
    snapshot_id: { type: 'string', description: 'New playlist snapshot ID after modification' },
  },
}
