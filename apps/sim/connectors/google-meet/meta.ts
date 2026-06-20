import { GoogleMeetIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const googleMeetConnectorMeta: ConnectorMeta = {
  id: 'google_meet',
  name: 'Google Meet',
  description: 'Sync meeting transcripts from Google Meet into your knowledge base',
  version: '1.0.0',
  icon: GoogleMeetIcon,

  auth: {
    mode: 'oauth',
    provider: 'google-meet',
    requiredScopes: ['https://www.googleapis.com/auth/meetings.space.readonly'],
  },

  configFields: [
    {
      id: 'maxMeetings',
      title: 'Max Meetings',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 200 (default: unlimited)',
      description: 'Cap the total number of meetings synced. Leave blank to sync all.',
    },
    {
      id: 'lookbackDays',
      title: 'Lookback Window (days)',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. 90 (default: all time)',
      description: 'Only sync meetings from the last N days. Leave blank to sync any age.',
    },
  ],

  tagDefinitions: [
    { id: 'participants', displayName: 'Participants', fieldType: 'text' },
    { id: 'duration', displayName: 'Duration (minutes)', fieldType: 'number' },
    { id: 'meetingDate', displayName: 'Meeting Date', fieldType: 'date' },
  ],
}
