import { spotifyLibraryUrl } from '@/tools/spotify/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyFollowPlaylistParams {
  accessToken: string
  playlistId: string
  public?: boolean
}

interface SpotifyFollowPlaylistResponse extends ToolResponse {
  output: { success: boolean }
}

/**
 * Whether the follow must stay off the user's public profile. Only Spotify's legacy
 * `PUT /playlists/{id}/followers` endpoint takes `public: false` (Extended Quota Mode apps only);
 * every other follow goes through `PUT /me/library`, which works in both quota modes.
 */
function followsPrivately(params: SpotifyFollowPlaylistParams): boolean {
  return params.public === false || String(params.public) === 'false'
}

export const spotifyFollowPlaylistTool: ToolConfig<
  SpotifyFollowPlaylistParams,
  SpotifyFollowPlaylistResponse
> = {
  id: 'spotify_follow_playlist',
  name: 'Spotify Follow Playlist',
  description: 'Follow (save) a playlist.',
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
      description: 'The Spotify playlist ID',
    },
    public: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      default: true,
      description:
        'Whether the playlist will appear in public playlists. False is only supported by Spotify apps in Extended Quota Mode',
    },
  },

  request: {
    url: (params) =>
      followsPrivately(params)
        ? `https://api.spotify.com/v1/playlists/${params.playlistId}/followers`
        : spotifyLibraryUrl(params.playlistId, 'playlist'),
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => (followsPrivately(params) ? { public: false } : undefined),
  },

  transformResponse: async (): Promise<SpotifyFollowPlaylistResponse> => {
    return { success: true, output: { success: true } }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether follow succeeded' },
  },
}
