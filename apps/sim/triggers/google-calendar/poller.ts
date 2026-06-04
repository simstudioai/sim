import { GoogleCalendarIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const googleCalendarPollingTrigger: TriggerConfig = {
  id: 'google_calendar_poller',
  name: 'Google Calendar Event Trigger',
  provider: 'google-calendar',
  description: 'Triggers when events are created, updated, or cancelled in Google Calendar',
  version: '1.0.0',
  icon: GoogleCalendarIcon,
  polling: true,

  subBlocks: [
    {
      id: 'triggerCredentials',
      title: 'Credentials',
      type: 'oauth-input',
      description: 'Connect your Google account to access Google Calendar.',
      serviceId: 'google-calendar',
      requiredScopes: [],
      required: true,
      mode: 'trigger',
      supportsCredentialSets: true,
      canonicalParamId: 'oauthCredential',
    },
    {
      id: 'calendarId',
      title: 'Calendar',
      type: 'file-selector',
      description: 'The calendar to monitor for event changes.',
      required: false,
      mode: 'trigger',
      canonicalParamId: 'calendarId',
      serviceId: 'google-calendar',
      selectorKey: 'google.calendar',
      selectorAllowSearch: false,
      dependsOn: ['triggerCredentials'],
    },
    {
      id: 'manualCalendarId',
      title: 'Calendar ID',
      type: 'short-input',
      placeholder: 'Enter calendar ID (e.g., primary or calendar@gmail.com)',
      description: 'The calendar to monitor for event changes.',
      required: false,
      mode: 'trigger-advanced',
      canonicalParamId: 'calendarId',
    },
    {
      id: 'eventTypeFilter',
      title: 'Event Type',
      type: 'dropdown',
      options: [
        { id: '', label: 'All Events' },
        { id: 'created', label: 'Created' },
        { id: 'updated', label: 'Updated' },
        { id: 'cancelled', label: 'Cancelled' },
      ],
      defaultValue: '',
      description: 'Only trigger for specific event types. Defaults to all events.',
      required: false,
      mode: 'trigger',
    },
    {
      id: 'searchTerm',
      title: 'Search Term',
      type: 'short-input',
      placeholder: 'e.g., team meeting, standup',
      description:
        'Optional: Filter events by text match across title, description, location, and attendees.',
      required: false,
      mode: 'trigger',
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Connect your Google account using OAuth credentials',
        'Select the calendar to monitor (defaults to your primary calendar)',
        'The system will automatically detect new, updated, and cancelled events',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
    },
  ],

  outputs: {
    event: {
      id: {
        type: 'string',
        description: 'Calendar event ID',
      },
      status: {
        type: 'string',
        description: 'Event status (confirmed, tentative, cancelled)',
      },
      eventType: {
        type: 'string',
        description: 'Change type: "created", "updated", or "cancelled"',
      },
      summary: {
        type: 'string',
        description: 'Event title',
      },
      eventDescription: {
        type: 'string',
        description: 'Event description',
      },
      location: {
        type: 'string',
        description: 'Event location',
      },
      htmlLink: {
        type: 'string',
        description: 'Link to event in Google Calendar',
      },
      start: {
        type: 'json',
        description: 'Event start time',
      },
      end: {
        type: 'json',
        description: 'Event end time',
      },
      created: {
        type: 'string',
        description: 'Event creation time',
      },
      updated: {
        type: 'string',
        description: 'Event last updated time',
      },
      attendees: {
        type: 'json',
        description: 'Event attendees',
      },
      creator: {
        type: 'json',
        description: 'Event creator',
      },
      organizer: {
        type: 'json',
        description: 'Event organizer',
      },
    },
    calendarId: {
      type: 'string',
      description: 'Calendar ID',
    },
    timestamp: {
      type: 'string',
      description: 'Event processing timestamp in ISO format',
    },
  },
}
