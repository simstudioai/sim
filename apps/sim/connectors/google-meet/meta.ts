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

  /**
   * `conferenceRecords.list` returns only the conferences the caller
   * organized, so a member's crawl never reaches a meeting they cannot read.
   * It also omits meetings they merely attended, the same shape as Zoom's
   * own-recordings listing.
   */
  permissionScopedListing: { capFieldIds: ['maxMeetings'] },
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
      placeholder: 'e.g. 30 (default: all available)',
      description:
        'Only sync meetings from the last N days. Google keeps transcript entry data for 30 days after a conference ends and deletes the conference record itself on the same schedule, so older meetings have nothing left to index.',
    },
    {
      id: 'includeParticipants',
      title: 'Include Participants',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Yes (default)', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      description:
        'When Yes, participant display names are written into the indexed transcript — in the participant list, and as the speaker label on every line — and into the Participants tag. Dial-in participants are named by a partially redacted phone number and anonymous joiners by whatever name they typed. Indexed text is embedded into searchable chunks, so anyone with access to this knowledge base can retrieve those identifiers. Choose No to index a participant count and pseudonymous speaker labels instead, and drop the Participants tag.',
    },
  ],

  tagDefinitions: [
    { id: 'participants', displayName: 'Participants', fieldType: 'text' },
    { id: 'duration', displayName: 'Duration (minutes)', fieldType: 'number' },
    { id: 'meetingDate', displayName: 'Meeting Date', fieldType: 'date' },
  ],
}
