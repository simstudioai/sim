import { FathomIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const fathomConnectorMeta: ConnectorMeta = {
  id: 'fathom',
  name: 'Fathom',
  description: 'Sync meeting transcripts and summaries from Fathom',
  version: '1.0.0',
  icon: FathomIcon,

  auth: {
    mode: 'apiKey',
    label: 'API Key',
    placeholder: 'Enter your Fathom API key',
  },

  supportsIncrementalSync: true,

  configFields: [
    {
      id: 'recordedBy',
      title: 'Filter by Recorder Email',
      type: 'short-input',
      placeholder: 'e.g. john@example.com',
      required: false,
      description: 'Only sync meetings recorded by this email',
    },
    {
      id: 'teams',
      title: 'Filter by Team',
      type: 'short-input',
      placeholder: 'e.g. Sales',
      required: false,
      description: 'Only sync meetings belonging to this team',
    },
    {
      id: 'meetingType',
      title: 'Filter by Meeting Type',
      type: 'dropdown',
      mode: 'advanced',
      required: false,
      description:
        'Only sync internal meetings (everyone shares the recorder’s domain) or external meetings (at least one outside attendee). Leave as All to sync both.',
      options: [
        { id: 'all', label: 'All meetings' },
        { id: 'one_or_more_external', label: 'External (customer-facing) only' },
        { id: 'only_internal', label: 'Internal only' },
      ],
    },
    {
      id: 'inviteeDomains',
      title: 'Filter by Attendee Domain',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. acme.com',
      required: false,
      description:
        'Only sync meetings that include a calendar invitee from this company email domain (exact match).',
    },
    {
      id: 'maxMeetings',
      title: 'Max Meetings',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 200 (default: unlimited)',
    },
  ],

  tagDefinitions: [
    { id: 'title', displayName: 'Title', fieldType: 'text' },
    { id: 'recordedByEmail', displayName: 'Recorded By (Email)', fieldType: 'text' },
    { id: 'recordedByName', displayName: 'Recorded By (Name)', fieldType: 'text' },
    { id: 'team', displayName: 'Team', fieldType: 'text' },
    { id: 'meetingType', displayName: 'Meeting Type', fieldType: 'text' },
    { id: 'transcriptLanguage', displayName: 'Language', fieldType: 'text' },
    { id: 'durationSeconds', displayName: 'Duration (seconds)', fieldType: 'number' },
    { id: 'meetingDate', displayName: 'Meeting Date', fieldType: 'date' },
  ],
}
