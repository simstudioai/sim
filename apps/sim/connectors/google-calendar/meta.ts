import { GoogleCalendarIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const DEFAULT_MAX_EVENTS = 500

export const googleCalendarConnectorMeta: ConnectorMeta = {
  id: 'google_calendar',
  name: 'Google Calendar',
  description: 'Sync calendar events from Google Calendar',
  version: '1.0.0',
  icon: GoogleCalendarIcon,
  search: true,
  searchDocsUrl: 'https://docs.sim.ai/search/google-calendar',
  memberSetupHint:
    'Each teammate connects their Google Calendar account. They see only event details available to them.',

  auth: {
    mode: 'oauth',
    provider: 'google-calendar',
    requiredScopes: ['https://www.googleapis.com/auth/calendar'],
  },

  permissionScopedListing: { capFieldIds: ['maxEvents'] },
  configFields: [
    {
      id: 'calendarSelector',
      title: 'Calendars',
      type: 'selector',
      selectorKey: 'google.calendar',
      canonicalParamId: 'calendarId',
      mode: 'basic',
      multi: true,
      placeholder: 'Select one or more calendars',
      required: false,
      description: 'Calendars to sync from. Defaults to your primary calendar.',
    },
    {
      id: 'calendarId',
      title: 'Calendar IDs',
      type: 'short-input',
      canonicalParamId: 'calendarId',
      mode: 'advanced',
      multi: true,
      placeholder: 'e.g. primary, team@group.calendar.google.com (comma-separated for multiple)',
      required: false,
      description:
        'Calendars to sync from. Use "primary" for your main calendar. Defaults to "primary".',
    },
    {
      id: 'dateRange',
      title: 'Date Range',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Last 30 days + next 30 days (default)', id: 'default' },
        { label: 'Past events only (last 30 days)', id: 'past_only' },
        { label: 'Future events only (next 30 days)', id: 'future_only' },
        { label: 'Extended range (90 days each way)', id: 'past_90' },
      ],
    },
    {
      id: 'searchQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'e.g. standup, sprint review (optional)',
      required: false,
      description:
        'Free-text search. Google matches it against the event summary, description, location, and the organizer and attendee names and email addresses.',
    },
    {
      id: 'includeAttendees',
      title: 'Include Attendees',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Yes (default)', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      description:
        'Include organizer and attendee names and email addresses in searchable event details. Choose No to include only the attendee count.',
    },
    {
      id: 'maxEvents',
      title: 'Max Events',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 500 (default: ${DEFAULT_MAX_EVENTS})`,
    },
  ],

  tagDefinitions: [
    { id: 'organizer', displayName: 'Organizer', fieldType: 'text' },
    { id: 'attendeeCount', displayName: 'Attendee Count', fieldType: 'number' },
    { id: 'location', displayName: 'Location', fieldType: 'text' },
    { id: 'eventDate', displayName: 'Event Date', fieldType: 'date' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
    { id: 'createdAt', displayName: 'Created', fieldType: 'date' },
  ],
}
