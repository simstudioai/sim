import type { ToolConfig } from '@/tools/types'

export const yandexMusicGetTrackDetailsTool: ToolConfig = {
  id: 'yandex_music_get_track_details',
  name: 'Retrieve Specific Track Details',
  description: 'Fetches comprehensive metadata for a single track, including duration, album association, and genre tags.',
  version: '1.0.0',

  params: {
    track_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier for the track.',
    },
  },

  outputs: {
    track_id: {
      type: 'string',
      description: 'Unique ID of the retrieved track.',
    },
    title: {
      type: 'string',
      description: 'The official title of the song.',
    },
    artist_name: {
      type: 'string',
      description: 'Primary performing artist.',
    },
    duration_seconds: {
      type: 'string',
      description: 'Length of the track in seconds.',
      optional: true,
    },
  },

  request: {
    url: () => `https://api.yandex.ru/music/v1/v1/tracks/${params.track_id}`,
    method: () => 'GET',
    headers: (params) => ({
      'Authorization': `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),

  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      track_id: data.track_id ?? '',
      title: data.title ?? '',
      artist_name: data.artist_name ?? '',
      duration_seconds: data.duration_seconds ?? 0,
    }
  },
}
