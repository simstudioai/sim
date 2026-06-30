import { ZoomIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const zoomConnectorMeta: ConnectorMeta = {
  id: 'zoom',
  name: 'Zoom',
  description: 'Sync meeting transcripts from Zoom cloud recordings',
  version: '1.0.0',
  icon: ZoomIcon,

  auth: {
    mode: 'oauth',
    provider: 'zoom',
    requiredScopes: [
      'user:read:user',
      'cloud_recording:read:list_user_recordings',
      'cloud_recording:read:list_recording_files',
    ],
  },

  supportsIncrementalSync: true,

  configFields: [
    {
      id: 'lookback',
      title: 'Date Range',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Last 30 days', id: '30' },
        { label: 'Last 90 days', id: '90' },
        { label: 'Last 6 months (recommended)', id: '180' },
      ],
      description:
        'On initial sync only. Zoom only allows access to cloud recordings within the last 6 months.',
    },
    {
      id: 'maxRecordings',
      title: 'Max Recordings',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 200 (default: unlimited)',
    },
  ],

  tagDefinitions: [
    { id: 'topic', displayName: 'Topic', fieldType: 'text' },
    { id: 'hostEmail', displayName: 'Host Email', fieldType: 'text' },
    { id: 'duration', displayName: 'Duration (minutes)', fieldType: 'number' },
    { id: 'meetingDate', displayName: 'Meeting Date', fieldType: 'date' },
  ],
}
