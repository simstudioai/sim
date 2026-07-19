import { YandexMusicIcon } from '@/components/icons-generated/yandex_music'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

export const YandexMusicBlock: BlockConfig = {
  type: 'yandex_music',
  name: 'Yandex Music',
  description:
    'Integrate with Yandex Music API to search, manage playlists, and retrieve track/album metadata.',
  category: 'tools',
  integrationType: IntegrationType.Communication,
  bgColor: '#6366f1',
  icon: YandexMusicIcon,
  authMode: AuthMode.OAuth,

  triggerAllowed: true,
  triggers: {
    enabled: true,
    available: ['yandex_music_webhook'],
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search Tracks by Query', id: 'yandex_music_search_tracks' },
        { label: 'Retrieve Specific Track Details', id: 'yandex_music_get_track_details' },
        { label: 'Create New Playlist', id: 'yandex_music_create_playlist' },
        { label: 'Add Tracks to Existing Playlist', id: 'yandex_music_add_tracks_to_playlist' },
        { label: 'Retrieve User Profile Information', id: 'yandex_music_get_user_profile' },
        { label: 'Search Albums by Query', id: 'yandex_music_search_albums' },
      ],
      value: () => 'yandex_music_search_tracks',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your api key',
    },
  ],

  tools: {
    access: [
      'yandex_music_add_tracks_to_playlist',
      'yandex_music_create_playlist',
      'yandex_music_get_track_details',
      'yandex_music_get_user_profile',
      'yandex_music_search_albums',
      'yandex_music_search_tracks',
    ],
    config: {
      tool: (params: Record<string, any>) => params.operation,
      params: (params: Record<string, any>) => ({
        apiKey: (params as any).apiKey ?? '',
      }),
    },
  },

  inputs: {},
  outputs: {},
}

export const YandexMusicBlockMeta: BlockMeta = {
  tags: ['automation'],
}
