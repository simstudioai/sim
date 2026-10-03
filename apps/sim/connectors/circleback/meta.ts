import { CirclebackIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const circlebackConnectorMeta: ConnectorMeta = {
  id: 'circleback',
  name: 'Circleback',
  description: 'Sync AI meeting notes and action items from Circleback',
  version: '1.0.0',
  icon: CirclebackIcon,

  auth: {
    mode: 'apiKey',
    label: 'API Key',
    placeholder: 'Enter your Circleback API key (cb_...)',
  },

  configFields: [
    {
      id: 'ownership',
      title: 'Meetings to Sync',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'My meetings', id: 'Mine' },
        { label: 'All meetings I can access', id: 'All' },
        { label: 'Meetings shared with me', id: 'Shared' },
      ],
      description: 'Which meetings to sync. Defaults to meetings you own.',
    },
    {
      id: 'includeTranscript',
      title: 'Include Transcript',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      description:
        'Append the full meeting transcript to each synced document. Transcripts are long and increase indexing volume.',
    },
    {
      id: 'maxMeetings',
      title: 'Max Meetings',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 200 (default: unlimited)',
      description: 'Cap the number of meetings synced. Leave blank to sync all meetings.',
    },
    {
      id: 'tagIds',
      title: 'Tag IDs',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. 3, 7',
      description:
        'Scope the sync to meetings with any of these comma-separated Circleback tag IDs. Leave blank to sync all meetings.',
    },
  ],

  tagDefinitions: [
    { id: 'title', displayName: 'Title', fieldType: 'text' },
    { id: 'attendees', displayName: 'Attendees', fieldType: 'text' },
    { id: 'tags', displayName: 'Tags', fieldType: 'text' },
    { id: 'meetingDate', displayName: 'Meeting Date', fieldType: 'date' },
    { id: 'duration', displayName: 'Duration (seconds)', fieldType: 'number' },
  ],
}
