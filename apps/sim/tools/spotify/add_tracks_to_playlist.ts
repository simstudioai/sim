import type {
  SpotifyAddTracksToPlaylistParams,
  SpotifyAddTracksToPlaylistResponse,
} from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifyAddTracksToPlaylistTool: ToolConfig<
  SpotifyAddTracksToPlaylistParams,
  SpotifyAddTracksToPlaylistResponse
> = {
  id: 'spotify_add_tracks_to_playlist',
  name: 'Spotify Add Tracks to Playlist',
  description: 'Add one or more tracks to a Spotify playlist.',
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
      description: 'Comma-separated Spotify URIs (e.g., "spotify:track:xxx,spotify:track:yyy")',
    },
    position: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Position to insert tracks (0-based index). If omitted, tracks are appended.',
    },
  },

  request: {
    url: (params) => `https://api.spotify.com/v1/playlists/${params.playlistId}/tracks`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const uris = params.uris.split(',').map((uri) => uri.trim())
      const body: any = { uris }
      if (params.position !== undefined) {
        body.position = params.position
      }
      return body
    },
  },

  transformResponse: async (response): Promise<SpotifyAddTracksToPlaylistResponse> => {
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
