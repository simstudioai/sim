import type { ToolConfig } from '@/tools/types'

export const yandexMusicAddTracksToPlaylistTool: ToolConfig = {
  id: 'yandex_music_add_tracks_to_playlist',
  name: 'Add Tracks to Existing Playlist',
  description: 'Adds one or more tracks (by ID) to a specified playlist.',
  version: '1.0.0',

  params: {
    playlist_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the target playlist.',
    },
    track_ids: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'A list of track IDs to be added.',
    },
  },

  outputs: {
    success_count: {
      type: 'string',
      description: 'Number of tracks successfully added.',
    },
    failed_ids: {
      type: 'array',
      description: 'List of track IDs that could not be added (e.g., already present).',
      optional: true,
    },
  },

  request: {
    url: () => `https://api.yandex.ru/music/v1/v1/playlists/${params.playlist_id}/tracks`,
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
      success_count: data.success_count ?? 0,
      failed_ids: data.failed_ids ?? null,
    }
  },
}
