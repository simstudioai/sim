import { FirefliesIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const firefliesConnectorMeta: ConnectorMeta = {
  id: 'fireflies',
  name: 'Fireflies',
  description: 'Sync meeting transcripts from Fireflies.ai',
  version: '1.0.0',
  icon: FirefliesIcon,

  auth: {
    mode: 'apiKey',
    label: 'API Key',
    placeholder: 'Enter your Fireflies API key',
  },

  configFields: [
    {
      id: 'hostEmail',
      title: 'Filter by Host Email',
      type: 'short-input',
      placeholder: 'e.g. john@example.com',
      required: false,
      description: 'Only sync transcripts hosted by this email',
    },
    {
      id: 'maxTranscripts',
      title: 'Max Transcripts',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 100 (default: unlimited)',
    },
  ],

  tagDefinitions: [
    { id: 'hostEmail', displayName: 'Host Email', fieldType: 'text' },
    { id: 'speakers', displayName: 'Speakers', fieldType: 'text' },
    { id: 'duration', displayName: 'Duration (seconds)', fieldType: 'number' },
    { id: 'meetingDate', displayName: 'Meeting Date', fieldType: 'date' },
  ],
}
