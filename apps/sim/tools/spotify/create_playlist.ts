import type {
  SpotifyCreatePlaylistParams,
  SpotifyCreatePlaylistResponse,
} from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifyCreatePlaylistTool: ToolConfig<
  SpotifyCreatePlaylistParams,
  SpotifyCreatePlaylistResponse
> = {
  id: 'spotify_create_playlist',
  name: 'Spotify Create Playlist',
  description: 'Create a new playlist for the current user on Spotify.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['playlist-modify-public', 'playlist-modify-private'],
  },

  params: {
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name for the new playlist',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description for the playlist',
    },
    public: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      default: true,
      description: 'Whether the playlist should be public',
    },
    collaborative: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      default: false,
      description: 'Whether the playlist should be collaborative (requires public to be false)',
    },
  },

  request: {
    url: () => 'https://api.spotify.com/v1/me/playlists',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      name: params.name,
      description: params.description || '',
      public: params.public !== false,
      collaborative: params.collaborative === true,
    }),
  },

  transformResponse: async (response): Promise<SpotifyCreatePlaylistResponse> => {
    const playlist = await response.json()

    return {
      success: true,
      output: {
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        public: playlist.public,
        collaborative: playlist.collaborative,
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
    collaborative: { type: 'boolean', description: 'Whether collaborative' },
    snapshot_id: { type: 'string', description: 'Playlist snapshot ID' },
    external_url: { type: 'string', description: 'Spotify URL' },
  },
}
