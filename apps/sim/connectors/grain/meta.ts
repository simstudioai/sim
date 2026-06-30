import { GrainIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const grainConnectorMeta: ConnectorMeta = {
  id: 'grain',
  name: 'Grain',
  description: 'Sync meeting recording transcripts from Grain',
  version: '1.0.0',
  icon: GrainIcon,

  auth: {
    mode: 'apiKey',
    label: 'API Key',
    placeholder: 'Enter your Grain API key',
  },

  configFields: [
    {
      id: 'maxRecordings',
      title: 'Max Recordings',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 200 (default: unlimited)',
      description: 'Cap the total number of recordings synced. Leave blank to sync all.',
    },
    {
      id: 'lookbackDays',
      title: 'Lookback Window (days)',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. 90 (default: all time)',
      description: 'Only sync recordings from the last N days. Leave blank to sync any age.',
    },
    {
      id: 'participantScope',
      title: 'Participant Scope',
      type: 'dropdown',
      required: false,
      mode: 'advanced',
      description:
        'Limit to internal-only meetings or meetings that include an external participant. Leave as Any to sync both.',
      options: [
        { label: 'Any', id: '' },
        { label: 'Internal only', id: 'internal' },
        { label: 'External (has external participant)', id: 'external' },
      ],
    },
    {
      id: 'titleSearch',
      title: 'Title Search',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. weekly standup',
      description: 'Only sync recordings whose title matches this text. Leave blank to sync all.',
    },
    {
      id: 'teamId',
      title: 'Team ID',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      description:
        'Only sync recordings belonging to this team (Grain team UUID). Leave blank to sync all teams.',
    },
    {
      id: 'meetingTypeId',
      title: 'Meeting Type ID',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      description:
        'Only sync recordings of this meeting type (Grain meeting type UUID). Leave blank to sync all types.',
    },
  ],

  tagDefinitions: [
    { id: 'title', displayName: 'Title', fieldType: 'text' },
    { id: 'participants', displayName: 'Participants', fieldType: 'text' },
    { id: 'source', displayName: 'Source', fieldType: 'text' },
    { id: 'labels', displayName: 'Labels', fieldType: 'text' },
    { id: 'teams', displayName: 'Teams', fieldType: 'text' },
    { id: 'meetingType', displayName: 'Meeting Type', fieldType: 'text' },
    { id: 'duration', displayName: 'Duration (ms)', fieldType: 'number' },
    { id: 'meetingDate', displayName: 'Meeting Date', fieldType: 'date' },
  ],
}
