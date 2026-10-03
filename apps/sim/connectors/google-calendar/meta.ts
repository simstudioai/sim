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

  auth: {
    mode: 'oauth',
    provider: 'google-calendar',
    requiredScopes: ['https://www.googleapis.com/auth/calendar'],
    adminCredentialType: 'service_account',
    serviceAccountScopes: ['https://www.googleapis.com/auth/calendar.events.readonly'],
    adminServiceAccountScopes: ['https://www.googleapis.com/auth/admin.directory.user.readonly'],
    serviceAccountDelegationScopes: ['https://www.googleapis.com/auth/calendar.events.readonly'],
    serviceAccountSubjectFieldId: 'adminEmail',
  },

  permissionScopedListing: { capFieldIds: ['maxEvents'] },
  mirrorsSourceAcls: true,
  adminSetupHint:
    'Use a service account with domain-wide delegation to index selected Google Workspace calendars. Each person searches only their own view of events.',
  configFields: [
    {
      id: 'adminEmail',
      title: 'Directory administrator email',
      showInAdminModeOnly: true,
      type: 'short-input',
      required: false,
      placeholder: 'admin@yourcompany.com',
      description:
        'A Google Workspace administrator who can read the user directory. Calendars are read as each selected user.',
    },
    {
      id: 'userEmails',
      title: 'Users',
      showInAdminModeOnly: true,
      setupGroup: 'options',
      type: 'short-input',
      multi: true,
      required: false,
      placeholder: 'All active Google Workspace users',
      description:
        'Optional primary email addresses, separated by commas (up to 100). Leave blank to index all active users across this Google Workspace customer.',
    },
    {
      id: 'calendarSelector',
      title: 'Calendars',
      type: 'selector',
      selectorKey: 'google.calendar',
      hideInAdminMode: true,
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
      descriptionInAdminMode:
        'Leave blank or use "primary" for each selected user’s main calendar. Shared calendar IDs apply to each user who can read them.',
    },
    {
      id: 'dateRange',
      title: 'Date Range',
      type: 'dropdown',
      required: false,
      placeholder: 'Last 30 days + next 30 days (default)',
      options: [
        { label: 'Last 30 days + next 30 days (default)', id: 'default' },
        { label: 'Past events only (last 30 days)', id: 'past_only' },
        { label: 'Future events only (next 30 days)', id: 'future_only' },
        { label: 'Extended range (90 days each way)', id: 'past_90' },
      ],
    },
    {
      id: 'searchQuery',
      setupGroup: 'options',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'e.g. standup, sprint review (optional)',
      required: false,
      description:
        'Free-text search. Google matches it against the event summary, description, location, and the organizer and attendee names and email addresses.',
    },
    {
      id: 'includeAttendees',
      setupGroup: 'options',
      title: 'Include Attendees',
      type: 'dropdown',
      required: false,
      placeholder: 'Yes (default)',
      options: [
        { label: 'Yes (default)', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      description:
        'Include organizer and attendee names and email addresses in searchable event details. Choose No to include only the attendee count.',
    },
    {
      id: 'maxEvents',
      setupGroup: 'options',
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
