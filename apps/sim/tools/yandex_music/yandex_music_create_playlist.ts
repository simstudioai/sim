import type { ToolConfig } from '@/tools/types'

export const yandexMusicCreatePlaylistTool: ToolConfig = {
  id: 'yandex_music_create_playlist',
  name: 'Create New Playlist',
  description: 'Creates a new user-owned playlist within the service.',
  version: '1.0.0',

  params: {
    user_id: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The ID of the user creating the playlist (requires scope).',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The desired name for the new playlist.',
    },
  },

  outputs: {
    playlist_id: {
      type: 'string',
      description: 'The unique ID assigned to the newly created playlist.',
    },
    owner_id: {
      type: 'string',
      description: 'ID of the user who owns the playlist.',
    },
  },

  request: {
    url: () => `https://api.yandex.ru/music/v1/v1/playlists`,
    method: () => 'POST',
    headers: (params) => ({
      'Authorization': `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const { apiKey, ...bodyParams } = params
      return bodyParams
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      playlist_id: data.playlist_id ?? '',
      owner_id: data.owner_id ?? '',
    }
  },
}
