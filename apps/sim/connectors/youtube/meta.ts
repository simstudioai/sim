import { YouTubeIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const youtubeConnectorMeta: ConnectorMeta = {
  id: 'youtube',
  name: 'YouTube',
  description: 'Sync videos from a YouTube channel or playlist into your knowledge base',
  version: '1.0.0',
  icon: YouTubeIcon,

  auth: {
    mode: 'apiKey',
    label: 'YouTube Data API Key',
    placeholder: 'Enter your YouTube Data API v3 key',
  },

  configFields: [
    {
      id: 'channelId',
      title: 'Channel',
      type: 'short-input',
      placeholder: 'e.g. @mkbhd or UCXXXXXXXXXXXXXXXXXXXXXX',
      required: false,
      description:
        'Channel handle (@name), channel ID (starts with "UC"), or legacy username. Syncs the channel\'s uploaded videos.',
    },
    {
      id: 'playlistId',
      title: 'Playlist ID',
      type: 'short-input',
      placeholder: 'e.g. PLXXXXXXXXXXXXXXXX',
      required: false,
      description: 'Playlist ID. Takes precedence over Channel when both are set.',
    },
    {
      id: 'publishedAfter',
      title: 'Published After',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. 2024-01-01',
      description:
        'Only sync videos published on or after this date (ISO 8601, e.g. 2024-01-01). Applies to the video publish date.',
    },
    {
      id: 'excludeShorts',
      title: 'Exclude Shorts',
      type: 'dropdown',
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Include Shorts', id: 'false' },
        { label: 'Exclude Shorts (< 60s)', id: 'true' },
      ],
      description: 'Skip videos shorter than 60 seconds (Shorts).',
    },
    {
      id: 'maxVideos',
      title: 'Max Videos',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],

  tagDefinitions: [
    { id: 'channelTitle', displayName: 'Channel', fieldType: 'text' },
    { id: 'publishedAt', displayName: 'Published Date', fieldType: 'date' },
    { id: 'duration', displayName: 'Duration', fieldType: 'text' },
    { id: 'tags', displayName: 'Tags', fieldType: 'text' },
  ],
}
