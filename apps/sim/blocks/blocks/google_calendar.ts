import { GoogleCalendarIcon, TwilioIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import {
  GoogleCalendarBlockDisplay,
  GoogleCalendarV2BlockDisplay,
} from '@/blocks/blocks/google_calendar.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { createVersionedToolSelector, SERVICE_ACCOUNT_SUBBLOCKS } from '@/blocks/utils'
import type { GoogleCalendarResponse } from '@/tools/google_calendar/types'
import { getTrigger } from '@/triggers'

export const GoogleCalendarBlock: BlockConfig<GoogleCalendarResponse> = {
  ...GoogleCalendarBlockDisplay,
  authMode: AuthMode.OAuth,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Event', id: 'create' },
        { label: 'List Events', id: 'list' },
        { label: 'Get Event', id: 'get' },
        { label: 'Update Event', id: 'update' },
        { label: 'Delete Event', id: 'delete' },
        { label: 'Move Event', id: 'move' },
        { label: 'Get Recurring Instances', id: 'instances' },
        { label: 'List Calendars', id: 'list_calendars' },
        { label: 'Quick Add (Natural Language)', id: 'quick_add' },
        { label: 'Invite Attendees', id: 'invite' },
        { label: 'Check Free/Busy', id: 'freebusy' },
        { label: 'Create Calendar', id: 'create_calendar' },
        { label: 'Share Calendar', id: 'share_calendar' },
        { label: 'List Sharing', id: 'list_acl' },
        { label: 'Remove Sharing', id: 'unshare_calendar' },
      ],
      value: () => 'create',
    },
    {
      id: 'credential',
      title: 'Google Calendar Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      serviceId: 'google-calendar',
      requiredScopes: getScopesForService('google-calendar'),
      placeholder: 'Select Google Calendar account',
    },
    {
      id: 'manualCredential',
      title: 'Google Calendar Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    ...SERVICE_ACCOUNT_SUBBLOCKS,
    {
      id: 'calendarId',
      title: 'Calendar',
      type: 'file-selector',
      canonicalParamId: 'calendarId',
      serviceId: 'google-calendar',
      selectorKey: 'google.calendar',
      requiredScopes: getScopesForService('google-calendar'),
      placeholder: 'Select calendar',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: ['list_calendars', 'create_calendar', 'freebusy'],
        not: true,
      },
    },
    {
      id: 'manualCalendarId',
      title: 'Calendar ID',
      type: 'short-input',
      canonicalParamId: 'calendarId',
      placeholder: 'Enter calendar ID (e.g., primary or calendar@gmail.com)',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['list_calendars', 'create_calendar', 'freebusy'],
        not: true,
      },
    },

    {
      id: 'summary',
      title: 'Event Title',
      type: 'short-input',
      placeholder: 'Meeting with team',
      condition: { field: 'operation', value: 'create' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a clear, descriptive calendar event title based on the user's request.
The title should be concise but informative about the event's purpose.

Return ONLY the event title - no explanations, no extra text.`,
        placeholder: 'Describe the event...',
      },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Event description',
      condition: { field: 'operation', value: 'create' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a helpful calendar event description based on the user's request.
Include relevant details like:
- Purpose of the event
- Agenda items
- Preparation notes
- Links or resources

Return ONLY the description - no explanations, no extra text.`,
        placeholder: 'Describe the event details...',
      },
    },
    {
      id: 'location',
      title: 'Location',
      type: 'short-input',
      placeholder: 'Conference Room A',
      condition: { field: 'operation', value: 'create' },
    },
    {
      id: 'startDateTime',
      title: 'Start Date & Time',
      type: 'short-input',
      placeholder: '2025-06-03T10:00:00-08:00',
      condition: { field: 'operation', value: 'create' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp with timezone offset based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SS+HH:MM or YYYY-MM-DDTHH:MM:SS-HH:MM
Examples:
- "tomorrow at 2pm" -> Calculate tomorrow's date at 14:00:00 with local timezone offset
- "next Monday at 9am" -> Calculate next Monday at 09:00:00 with local timezone offset
- "in 2 hours" -> Calculate current time + 2 hours with local timezone offset

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start time (e.g., "tomorrow at 2pm", "next Monday at 9am")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'endDateTime',
      title: 'End Date & Time',
      type: 'short-input',
      placeholder: '2025-06-03T11:00:00-08:00',
      condition: { field: 'operation', value: 'create' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp with timezone offset based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SS+HH:MM or YYYY-MM-DDTHH:MM:SS-HH:MM
Examples:
- "tomorrow at 3pm" -> Calculate tomorrow's date at 15:00:00 with local timezone offset
- "1 hour after start" -> Calculate start time + 1 hour with local timezone offset
- "next Monday at 5pm" -> Calculate next Monday at 17:00:00 with local timezone offset

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end time (e.g., "tomorrow at 3pm", "1 hour after start")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'attendees',
      title: 'Attendees (comma-separated emails)',
      type: 'short-input',
      placeholder: 'john@example.com, jane@example.com',
      condition: { field: 'operation', value: 'create' },
    },

    {
      id: 'recurrence',
      title: 'Recurrence Rule',
      type: 'long-input',
      placeholder: 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
      condition: { field: 'operation', value: ['create', 'update'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an RFC 5545 recurrence rule (RRULE) for a Google Calendar event based on the user's description.
Examples:
- "every weekday" -> RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR
- "every Monday" -> RRULE:FREQ=WEEKLY;BYDAY=MO
- "monthly on the 1st" -> RRULE:FREQ=MONTHLY;BYMONTHDAY=1
- "daily for 10 occurrences" -> RRULE:FREQ=DAILY;COUNT=10

Return ONLY the RRULE string - no explanations, no extra text.`,
        placeholder: 'Describe the recurrence (e.g., "every weekday", "monthly on the 1st")...',
      },
    },
    {
      id: 'addGoogleMeet',
      title: 'Add Google Meet',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create', 'update'] },
      mode: 'advanced',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
    },
    {
      id: 'timeZone',
      title: 'Time Zone',
      type: 'short-input',
      placeholder: 'America/Los_Angeles',
      condition: { field: 'operation', value: ['create', 'update'] },
      mode: 'advanced',
    },

    {
      id: 'timeMin',
      title: 'Start Time Filter',
      type: 'short-input',
      placeholder: '2025-06-03T00:00:00Z',
      condition: { field: 'operation', value: 'list' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp in UTC based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "today" -> Calculate today's date at 00:00:00Z
- "yesterday" -> Calculate yesterday's date at 00:00:00Z
- "last week" -> Calculate 7 days ago at 00:00:00Z
- "beginning of this month" -> Calculate the first day of current month at 00:00:00Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start of time range (e.g., "today", "last week")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'timeMax',
      title: 'End Time Filter',
      type: 'short-input',
      placeholder: '2025-06-04T00:00:00Z',
      condition: { field: 'operation', value: 'list' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp in UTC based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "tomorrow" -> Calculate tomorrow's date at 00:00:00Z
- "end of today" -> Calculate today's date at 23:59:59Z
- "next week" -> Calculate 7 days from now at 00:00:00Z
- "end of this month" -> Calculate the last day of current month at 23:59:59Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end of time range (e.g., "tomorrow", "end of this week")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'q',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'standup',
      condition: { field: 'operation', value: 'list' },
    },
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'dropdown',
      condition: { field: 'operation', value: 'list' },
      mode: 'advanced',
      options: [
        { label: 'Start time', id: 'startTime' },
        { label: 'Last updated', id: 'updated' },
      ],
      value: () => 'startTime',
    },
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: 'Token from a previous response (nextPageToken)',
      condition: {
        field: 'operation',
        value: ['list', 'instances', 'list_calendars', 'list_acl'],
      },
      mode: 'advanced',
    },

    {
      id: 'eventId',
      title: 'Event ID',
      type: 'short-input',
      placeholder: 'Event ID',
      condition: {
        field: 'operation',
        value: ['get', 'update', 'delete', 'move', 'instances', 'invite'],
      },
      required: true,
    },

    {
      id: 'summary',
      title: 'New Event Title',
      type: 'short-input',
      placeholder: 'Updated meeting title',
      condition: { field: 'operation', value: 'update' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a clear, descriptive calendar event title based on the user's request.
The title should be concise but informative about the event's purpose.

Return ONLY the event title - no explanations, no extra text.`,
        placeholder: 'Describe the new event title...',
      },
    },
    {
      id: 'description',
      title: 'New Description',
      type: 'long-input',
      placeholder: 'Updated event description',
      condition: { field: 'operation', value: 'update' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a helpful calendar event description based on the user's request.
Include relevant details like:
- Purpose of the event
- Agenda items
- Preparation notes
- Links or resources

Return ONLY the description - no explanations, no extra text.`,
        placeholder: 'Describe the new event details...',
      },
    },
    {
      id: 'location',
      title: 'New Location',
      type: 'short-input',
      placeholder: 'Updated location',
      condition: { field: 'operation', value: 'update' },
    },
    {
      id: 'startDateTime',
      title: 'New Start Date & Time',
      type: 'short-input',
      placeholder: '2025-06-03T10:00:00-08:00',
      condition: { field: 'operation', value: 'update' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp with timezone offset based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SS+HH:MM or YYYY-MM-DDTHH:MM:SS-HH:MM
Examples:
- "tomorrow at 2pm" -> Calculate tomorrow's date at 14:00:00 with local timezone offset
- "next Monday at 9am" -> Calculate next Monday at 09:00:00 with local timezone offset
- "in 2 hours" -> Calculate current time + 2 hours with local timezone offset

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the new start time (e.g., "tomorrow at 2pm")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'endDateTime',
      title: 'New End Date & Time',
      type: 'short-input',
      placeholder: '2025-06-03T11:00:00-08:00',
      condition: { field: 'operation', value: 'update' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp with timezone offset based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SS+HH:MM or YYYY-MM-DDTHH:MM:SS-HH:MM
Examples:
- "tomorrow at 3pm" -> Calculate tomorrow's date at 15:00:00 with local timezone offset
- "1 hour after start" -> Calculate start time + 1 hour with local timezone offset
- "next Monday at 5pm" -> Calculate next Monday at 17:00:00 with local timezone offset

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the new end time (e.g., "tomorrow at 3pm")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'attendees',
      title: 'New Attendees (comma-separated emails)',
      type: 'short-input',
      placeholder: 'john@example.com, jane@example.com',
      condition: { field: 'operation', value: 'update' },
    },

    {
      id: 'destinationCalendar',
      title: 'Destination Calendar',
      type: 'file-selector',
      canonicalParamId: 'destinationCalendarId',
      serviceId: 'google-calendar',
      selectorKey: 'google.calendar',
      requiredScopes: getScopesForService('google-calendar'),
      placeholder: 'Select destination calendar',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'move' },
      required: true,
      mode: 'basic',
    },
    {
      id: 'manualDestinationCalendarId',
      title: 'Destination Calendar ID',
      type: 'short-input',
      canonicalParamId: 'destinationCalendarId',
      placeholder: 'destination@group.calendar.google.com',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'move' },
      required: true,
      mode: 'advanced',
    },

    {
      id: 'timeMin',
      title: 'Start Time Filter',
      type: 'short-input',
      placeholder: '2025-06-03T00:00:00Z',
      condition: { field: 'operation', value: 'instances' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp in UTC based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "today" -> Calculate today's date at 00:00:00Z
- "yesterday" -> Calculate yesterday's date at 00:00:00Z
- "last week" -> Calculate 7 days ago at 00:00:00Z
- "beginning of this month" -> Calculate the first day of current month at 00:00:00Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start of time range (e.g., "today", "last week")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'timeMax',
      title: 'End Time Filter',
      type: 'short-input',
      placeholder: '2025-06-04T00:00:00Z',
      condition: { field: 'operation', value: 'instances' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp in UTC based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "tomorrow" -> Calculate tomorrow's date at 00:00:00Z
- "end of today" -> Calculate today's date at 23:59:59Z
- "next week" -> Calculate 7 days from now at 00:00:00Z
- "end of this month" -> Calculate the last day of current month at 23:59:59Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end of time range (e.g., "tomorrow", "end of this week")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '250',
      condition: { field: 'operation', value: ['list', 'instances', 'list_calendars', 'list_acl'] },
    },

    {
      id: 'minAccessRole',
      title: 'Minimum Access Role',
      type: 'dropdown',
      condition: { field: 'operation', value: 'list_calendars' },
      options: [
        { label: 'Any Role', id: '' },
        { label: 'Free/Busy Reader', id: 'freeBusyReader' },
        { label: 'Reader', id: 'reader' },
        { label: 'Writer', id: 'writer' },
        { label: 'Owner', id: 'owner' },
      ],
    },

    {
      id: 'attendees',
      title: 'Attendees (comma-separated emails)',
      type: 'short-input',
      placeholder: 'john@example.com, jane@example.com',
      condition: { field: 'operation', value: 'invite' },
      required: true,
    },
    {
      id: 'replaceExisting',
      title: 'Replace Existing Attendees',
      type: 'dropdown',
      condition: { field: 'operation', value: 'invite' },
      options: [
        { label: 'Add to existing attendees', id: 'false' },
        { label: 'Replace all attendees', id: 'true' },
      ],
    },

    {
      id: 'text',
      title: 'Natural Language Event',
      type: 'long-input',
      placeholder: 'Meeting with John tomorrow at 3pm for 1 hour',
      condition: { field: 'operation', value: 'quick_add' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a natural language event description that Google Calendar can parse.
Include:
- Event title/purpose
- Date and time
- Duration (optional)
- Location (optional)

Examples:
- "Meeting with John tomorrow at 3pm for 1 hour"
- "Lunch at Cafe Milano on Friday at noon"
- "Team standup every Monday at 9am"

Return ONLY the natural language event text - no explanations.`,
        placeholder: 'Describe the event in natural language...',
      },
    },
    {
      id: 'attendees',
      title: 'Attendees (comma-separated emails)',
      type: 'short-input',
      placeholder: 'john@example.com, jane@example.com',
      condition: { field: 'operation', value: 'quick_add' },
    },

    {
      id: 'calendarIds',
      title: 'Calendars (comma-separated IDs)',
      type: 'short-input',
      placeholder: 'primary, teammate@example.com',
      condition: { field: 'operation', value: 'freebusy' },
      required: true,
    },
    {
      id: 'timeMin',
      title: 'Start Time',
      type: 'short-input',
      placeholder: '2025-06-03T00:00:00Z',
      condition: { field: 'operation', value: 'freebusy' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp in UTC based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "today" -> Calculate today's date at 00:00:00Z
- "next Monday" -> Calculate next Monday at 00:00:00Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start of the range (e.g., "today", "next Monday")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'timeMax',
      title: 'End Time',
      type: 'short-input',
      placeholder: '2025-06-04T00:00:00Z',
      condition: { field: 'operation', value: 'freebusy' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp in UTC based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "end of today" -> Calculate today's date at 23:59:59Z
- "next Friday" -> Calculate next Friday at 00:00:00Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end of the range (e.g., "end of today", "next Friday")...',
        generationType: 'timestamp',
      },
    },

    {
      id: 'summary',
      title: 'Calendar Name',
      type: 'short-input',
      placeholder: 'Team Calendar',
      condition: { field: 'operation', value: 'create_calendar' },
      required: true,
    },
    {
      id: 'description',
      title: 'Calendar Description',
      type: 'long-input',
      placeholder: 'Shared team events and milestones',
      condition: { field: 'operation', value: 'create_calendar' },
    },
    {
      id: 'location',
      title: 'Calendar Location',
      type: 'short-input',
      placeholder: 'San Francisco, CA',
      condition: { field: 'operation', value: 'create_calendar' },
    },
    {
      id: 'timeZone',
      title: 'Time Zone',
      type: 'short-input',
      placeholder: 'America/Los_Angeles',
      condition: { field: 'operation', value: ['create_calendar', 'freebusy'] },
    },

    {
      id: 'role',
      title: 'Access Role',
      type: 'dropdown',
      condition: { field: 'operation', value: 'share_calendar' },
      required: true,
      options: [
        { label: 'See free/busy only', id: 'freeBusyReader' },
        { label: 'See all event details (Reader)', id: 'reader' },
        { label: 'Make changes (Writer)', id: 'writer' },
        { label: 'Make changes & manage sharing (Owner)', id: 'owner' },
      ],
      value: () => 'reader',
    },
    {
      id: 'scopeType',
      title: 'Grantee Type',
      type: 'dropdown',
      condition: { field: 'operation', value: 'share_calendar' },
      required: true,
      options: [
        { label: 'User', id: 'user' },
        { label: 'Group', id: 'group' },
        { label: 'Domain', id: 'domain' },
        { label: 'Public (anyone)', id: 'default' },
      ],
      value: () => 'user',
    },
    {
      id: 'scopeValue',
      title: 'Grantee (email or domain)',
      type: 'short-input',
      placeholder: 'person@example.com',
      condition: {
        field: 'operation',
        value: 'share_calendar',
        and: { field: 'scopeType', value: 'default', not: true },
      },
      required: true,
    },
    {
      id: 'sendNotifications',
      title: 'Send Notification Email',
      type: 'dropdown',
      condition: { field: 'operation', value: 'share_calendar' },
      mode: 'advanced',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
    },

    {
      id: 'ruleId',
      title: 'ACL Rule ID',
      type: 'short-input',
      placeholder: 'user:person@example.com',
      condition: { field: 'operation', value: 'unshare_calendar' },
      required: true,
    },

    {
      id: 'sendUpdates',
      title: 'Send Email Notifications',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['create', 'update', 'delete', 'move', 'quick_add', 'invite'],
      },
      options: [
        { label: 'All attendees', id: 'all' },
        { label: 'External attendees only', id: 'externalOnly' },
        { label: 'None (no emails sent)', id: 'none' },
      ],
    },
    ...getTrigger('google_calendar_poller').subBlocks,
  ],
  tools: {
    access: [
      'google_calendar_create',
      'google_calendar_list',
      'google_calendar_get',
      'google_calendar_update',
      'google_calendar_delete',
      'google_calendar_move',
      'google_calendar_instances',
      'google_calendar_list_calendars',
      'google_calendar_quick_add',
      'google_calendar_invite',
      'google_calendar_freebusy',
      'google_calendar_create_calendar',
      'google_calendar_share_calendar',
      'google_calendar_list_acl',
      'google_calendar_unshare_calendar',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'create':
            return 'google_calendar_create'
          case 'list':
            return 'google_calendar_list'
          case 'get':
            return 'google_calendar_get'
          case 'update':
            return 'google_calendar_update'
          case 'delete':
            return 'google_calendar_delete'
          case 'move':
            return 'google_calendar_move'
          case 'instances':
            return 'google_calendar_instances'
          case 'list_calendars':
            return 'google_calendar_list_calendars'
          case 'quick_add':
            return 'google_calendar_quick_add'
          case 'invite':
            return 'google_calendar_invite'
          case 'freebusy':
            return 'google_calendar_freebusy'
          case 'create_calendar':
            return 'google_calendar_create_calendar'
          case 'share_calendar':
            return 'google_calendar_share_calendar'
          case 'list_acl':
            return 'google_calendar_list_acl'
          case 'unshare_calendar':
            return 'google_calendar_unshare_calendar'
          default:
            throw new Error(`Invalid Google Calendar operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          oauthCredential,
          operation,
          attendees,
          replaceExisting,
          calendarId,
          destinationCalendarId,
          ...rest
        } = params

        const effectiveCalendarId = calendarId ? String(calendarId).trim() : ''

        const effectiveDestinationCalendarId = destinationCalendarId
          ? String(destinationCalendarId).trim()
          : ''

        const processedParams: Record<string, any> = {
          ...rest,
          calendarId: effectiveCalendarId || 'primary',
        }

        if (operation === 'move' && effectiveDestinationCalendarId) {
          processedParams.destinationCalendarId = effectiveDestinationCalendarId
        }

        if (attendees && typeof attendees === 'string' && attendees.trim().length > 0) {
          const attendeeList = attendees
            .split(',')
            .map((email) => email.trim())
            .filter((email) => email.length > 0)

          if (attendeeList.length > 0) {
            processedParams.attendees = attendeeList
          }
        }

        if (operation === 'invite' && replaceExisting !== undefined) {
          processedParams.replaceExisting = replaceExisting === 'true'
        }

        if (processedParams.addGoogleMeet !== undefined) {
          processedParams.addGoogleMeet =
            processedParams.addGoogleMeet === 'true' || processedParams.addGoogleMeet === true
        }

        if (operation === 'share_calendar' && processedParams.sendNotifications !== undefined) {
          processedParams.sendNotifications =
            processedParams.sendNotifications === 'true' ||
            processedParams.sendNotifications === true
        }

        if (
          ['create', 'update', 'delete', 'move', 'quick_add', 'invite'].includes(operation) &&
          !processedParams.sendUpdates
        ) {
          processedParams.sendUpdates = 'all'
        }

        if (processedParams.maxResults && typeof processedParams.maxResults === 'string') {
          processedParams.maxResults = Number.parseInt(processedParams.maxResults, 10)
        }

        if (processedParams.minAccessRole === '') {
          processedParams.minAccessRole = undefined
        }

        return {
          oauthCredential,
          ...processedParams,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Google Calendar access token' },
    calendarId: { type: 'string', description: 'Calendar identifier (canonical param)' },

    summary: { type: 'string', description: 'Event title' },
    description: { type: 'string', description: 'Event description' },
    location: { type: 'string', description: 'Event location' },
    startDateTime: { type: 'string', description: 'Event start time' },
    endDateTime: { type: 'string', description: 'Event end time' },
    attendees: { type: 'string', description: 'Attendee email list' },
    recurrence: { type: 'string', description: 'Recurrence rule (RRULE)' },
    addGoogleMeet: { type: 'boolean', description: 'Attach a Google Meet link' },
    timeZone: { type: 'string', description: 'Time zone (IANA name)' },

    timeMin: { type: 'string', description: 'Start time filter' },
    timeMax: { type: 'string', description: 'End time filter' },
    q: { type: 'string', description: 'Free-text search query' },
    orderBy: { type: 'string', description: 'Event ordering (startTime or updated)' },
    maxResults: { type: 'string', description: 'Maximum number of results' },
    pageToken: { type: 'string', description: 'Pagination token from a previous response' },

    calendarIds: { type: 'string', description: 'Comma-separated calendar IDs' },

    role: { type: 'string', description: 'Access role to grant' },
    scopeType: { type: 'string', description: 'Grantee type (user, group, domain, default)' },
    scopeValue: { type: 'string', description: 'Grantee email or domain' },
    sendNotifications: { type: 'boolean', description: 'Send sharing notification email' },
    ruleId: { type: 'string', description: 'ACL rule ID to remove' },

    eventId: { type: 'string', description: 'Event identifier' },

    destinationCalendarId: {
      type: 'string',
      description: 'Destination calendar ID (canonical param)',
    },

    minAccessRole: { type: 'string', description: 'Minimum access role filter' },

    text: { type: 'string', description: 'Natural language event' },

    replaceExisting: { type: 'string', description: 'Replace existing attendees' },

    sendUpdates: { type: 'string', description: 'Send email notifications' },
  },
  outputs: {
    content: { type: 'string', description: 'Operation response content' },
    metadata: { type: 'json', description: 'Event or calendar metadata' },
  },
  triggers: {
    enabled: true,
    available: ['google_calendar_poller'],
  },
}

export const GoogleCalendarV2Block: BlockConfig<GoogleCalendarResponse> = {
  ...GoogleCalendarBlock,
  ...GoogleCalendarV2BlockDisplay,
  tools: {
    ...GoogleCalendarBlock.tools,
    access: [
      'google_calendar_create_v2',
      'google_calendar_list_v2',
      'google_calendar_get_v2',
      'google_calendar_update_v2',
      'google_calendar_delete_v2',
      'google_calendar_move_v2',
      'google_calendar_instances_v2',
      'google_calendar_list_calendars_v2',
      'google_calendar_quick_add_v2',
      'google_calendar_invite_v2',
      'google_calendar_freebusy_v2',
      'google_calendar_create_calendar_v2',
      'google_calendar_share_calendar_v2',
      'google_calendar_list_acl_v2',
      'google_calendar_unshare_calendar_v2',
    ],
    config: {
      ...GoogleCalendarBlock.tools?.config,
      tool: createVersionedToolSelector({
        baseToolSelector: (params) => `google_calendar_${params.operation || 'create'}`,
        suffix: '_v2',
        fallbackToolId: 'google_calendar_create_v2',
      }),
      params: GoogleCalendarBlock.tools?.config?.params,
    },
  },
  outputs: {
    id: { type: 'string', description: 'Event or calendar ID' },
    htmlLink: { type: 'string', description: 'Event link' },
    hangoutLink: { type: 'string', description: 'Google Meet link' },
    status: { type: 'string', description: 'Event status' },
    summary: { type: 'string', description: 'Event or calendar title' },
    description: { type: 'string', description: 'Event or calendar description' },
    location: { type: 'string', description: 'Event or calendar location' },
    recurrence: { type: 'json', description: 'Recurrence rules (RRULE)' },
    start: { type: 'json', description: 'Event start' },
    end: { type: 'json', description: 'Event end' },
    attendees: { type: 'json', description: 'Event attendees' },
    creator: { type: 'json', description: 'Event creator' },
    organizer: { type: 'json', description: 'Event organizer' },
    events: { type: 'json', description: 'List of events (list operation)' },
    eventId: { type: 'string', description: 'Deleted event ID' },
    deleted: { type: 'boolean', description: 'Whether deletion/removal was successful' },
    instances: { type: 'json', description: 'List of recurring event instances' },
    calendars: { type: 'json', description: 'List of calendars' },
    timeMin: { type: 'string', description: 'Start of the queried free/busy range' },
    timeMax: { type: 'string', description: 'End of the queried free/busy range' },
    role: { type: 'string', description: 'Granted access role (share operation)' },
    scope: { type: 'json', description: 'Grantee scope (share operation)' },
    rules: { type: 'json', description: 'List of ACL sharing rules (list sharing operation)' },
    ruleId: { type: 'string', description: 'Removed ACL rule ID (remove sharing operation)' },
    nextPageToken: { type: 'string', description: 'Next page token' },
    timeZone: { type: 'string', description: 'Calendar time zone' },
  },
}

export const GoogleCalendarBlockMeta = {
  tags: ['calendar', 'scheduling', 'google-workspace'],
  url: 'https://workspace.google.com/products/calendar',
  templates: [
    {
      icon: GoogleCalendarIcon,
      title: 'Meeting prep agent',
      prompt:
        'Create an agent that checks my Google Calendar each morning, researches every attendee and topic on the web, and prepares a brief for each meeting so I walk in fully prepared. Schedule it to run every weekday morning.',
      image: '/templates/meeting-prep-dark.png',
      modules: ['agent', 'scheduled', 'workflows'],
      category: 'popular',
      tags: ['founder', 'sales', 'research', 'automation'],
      featured: true,
    },
    {
      icon: TwilioIcon,
      title: 'SMS appointment reminders',
      prompt:
        'Create a scheduled workflow that checks Google Calendar each morning for appointments in the next 24 hours, and sends an SMS reminder to each attendee via Twilio with the meeting time, location, and any prep notes.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'communication', 'automation'],
      alsoIntegrations: ['twilio_sms'],
    },
    {
      icon: GoogleCalendarIcon,
      title: 'Booking-to-calendar scheduler',
      prompt:
        'Build a workflow that on a new Calendly booking creates the matching Google Calendar event, invites the attendees, attaches the meeting agenda, and writes the event link back so both systems stay in sync.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'scheduling', 'automation'],
      alsoIntegrations: ['calendly'],
    },
    {
      icon: GoogleCalendarIcon,
      title: 'Daily agenda digest',
      prompt:
        'Create a scheduled weekday workflow that lists my Google Calendar events for the day, summarizes them with attendee context and prep notes, and posts a clean morning agenda to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'reporting', 'communication'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleCalendarIcon,
      title: 'Interview scheduling coordinator',
      prompt:
        "Build a workflow that when a candidate reaches the interview stage finds open slots across the panel's Google Calendars, creates the interview event with the video link, invites everyone, and emails the candidate the confirmation.",
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'scheduling', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: GoogleCalendarIcon,
      title: 'Meeting-load weekly report',
      prompt:
        'Create a scheduled weekly workflow that lists Google Calendar events for the team, computes total meeting hours and recurring-meeting load per person, writes the breakdown to a table, and flags anyone over the focus-time threshold.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['team', 'reporting', 'analysis'],
    },
    {
      icon: GoogleCalendarIcon,
      title: 'Calendar event note-taker prep',
      prompt:
        'Build a workflow that scans upcoming Google Calendar events for external meetings, researches each company and attendee, drafts talking points, and updates the event description so the notes travel with the invite.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'automation'],
    },
  ],
  skills: [
    {
      name: 'schedule-meeting',
      description:
        'Create a Google Calendar event with the right time, attendees, and details, sending invites.',
      content:
        '# Schedule a Meeting\n\nCreate a calendar event and invite attendees.\n\n## Steps\n1. Determine the calendar (default to `primary`), title, start and end times, location, and description from the request.\n2. Convert times to ISO 8601 with the correct timezone offset (e.g., `2025-06-03T10:00:00-08:00`).\n3. If the request is conversational (e.g., "lunch with John tomorrow at noon"), use Quick Add instead of building each field by hand.\n4. Run Create Event (or Quick Add) with the attendee emails as a comma-separated list.\n5. Set Send Email Notifications to `all` so attendees are invited.\n\n## Output\nConfirm the created event: title, start/end in a readable format, attendees, and the event link (htmlLink). If a conflict is likely, note it.',
    },
    {
      name: 'summarize-daily-agenda',
      description:
        "List today's Google Calendar events and produce a clean, ordered agenda summary.",
      content:
        '# Summarize the Daily Agenda\n\nProduce a readable agenda for a day or window.\n\n## Steps\n1. Resolve the target window into UTC ISO timestamps for Start Time Filter (timeMin) and End Time Filter (timeMax). For "today", use 00:00:00Z to 23:59:59Z.\n2. Run List Events on the chosen calendar with those filters and a reasonable Max Results.\n3. Sort events chronologically and read summary, start/end, location, and attendees for each.\n4. Flag back-to-back meetings and any event with no agenda or description.\n\n## Output\nA chronological agenda. Each line: time range, title, location (if any), and attendee count. Add a short header with total meetings and total meeting hours.',
    },
    {
      name: 'find-and-reschedule-event',
      description: 'Locate an existing event and update its time, attendees, or details.',
      content:
        '# Find and Reschedule an Event\n\nUpdate an existing calendar event.\n\n## Steps\n1. If you do not have the event ID, run List Events over a suitable window and match by title/attendees to find the event ID.\n2. Run Get Event to read the current details and confirm it is the right one.\n3. Run Update Event with only the changed fields (new start/end in ISO 8601 with offset, new attendees, new location, or title).\n4. Set Send Email Notifications to `all` so attendees see the change.\n\n## Output\nConfirm what changed (old vs new time/attendees) and return the event link. If multiple events matched, list them and ask which to update before changing anything destructive.',
    },
    {
      name: 'invite-attendees-to-event',
      description: 'Add attendees to an existing Google Calendar event and notify them.',
      content:
        '# Invite Attendees to an Event\n\nAdd people to an event without recreating it.\n\n## Steps\n1. Obtain the event ID (use List Events to find it if needed).\n2. Collect the attendee emails to add as a comma-separated list.\n3. Run Invite Attendees with Replace Existing set to `Add to existing attendees` (unless asked to replace the whole list).\n4. Set Send Email Notifications to `all`.\n\n## Output\nConfirm the added attendees and the resulting full attendee list, with the event link.',
    },
  ],
} as const satisfies BlockMeta

export const GoogleCalendarV2BlockMeta = {
  tags: ['calendar', 'scheduling', 'google-workspace'],
  url: 'https://workspace.google.com/products/calendar',
} as const satisfies BlockMeta
