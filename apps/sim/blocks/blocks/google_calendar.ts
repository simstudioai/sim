import { GoogleCalendarIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { createVersionedToolSelector } from '@/blocks/utils'
import type { GoogleCalendarResponse } from '@/tools/google_calendar/types'

export const GoogleCalendarBlock: BlockConfig<GoogleCalendarResponse> = {
  type: 'google_calendar',
  name: 'Google Calendar (Legacy)',
  description: 'Manage Google Calendar events',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Google Calendar into the workflow. Can create, read, update, and list calendar events.',
  docsLink: 'https://docs.sim.ai/tools/google_calendar',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: GoogleCalendarIcon,
  hideFromToolbar: true,
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
      ],
      value: () => 'create',
    },
    {
      id: 'credential',
      title: 'Google Calendar Account',
      type: 'oauth-input',
      required: true,
      serviceId: 'google-calendar',
      requiredScopes: ['https://www.googleapis.com/auth/calendar'],
      placeholder: 'Select Google Calendar account',
    },
    // Calendar selector (basic mode) - not needed for list_calendars
    {
      id: 'calendarId',
      title: 'Calendar',
      type: 'file-selector',
      canonicalParamId: 'calendarId',
      serviceId: 'google-calendar',
      requiredScopes: ['https://www.googleapis.com/auth/calendar'],
      placeholder: 'Select calendar',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'list_calendars', not: true },
    },
    // Manual calendar ID input (advanced mode) - not needed for list_calendars
    {
      id: 'manualCalendarId',
      title: 'Calendar ID',
      type: 'short-input',
      canonicalParamId: 'calendarId',
      placeholder: 'Enter calendar ID (e.g., primary or calendar@gmail.com)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_calendars', not: true },
    },

    // Create Event Fields
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

    // List Events Fields
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

    // Get Event Fields
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

    // Update Event Fields
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

    // Move Event Fields - Destination calendar selector (basic mode)
    {
      id: 'destinationCalendar',
      title: 'Destination Calendar',
      type: 'file-selector',
      canonicalParamId: 'destinationCalendarId',
      serviceId: 'google-calendar',
      requiredScopes: ['https://www.googleapis.com/auth/calendar'],
      placeholder: 'Select destination calendar',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'move' },
      required: true,
      mode: 'basic',
    },
    // Move Event Fields - Manual destination calendar ID (advanced mode)
    {
      id: 'manualDestinationCalendarId',
      title: 'Destination Calendar ID',
      type: 'short-input',
      canonicalParamId: 'destinationCalendarId',
      placeholder: 'destination@group.calendar.google.com',
      condition: { field: 'operation', value: 'move' },
      required: true,
      mode: 'advanced',
    },

    // Instances Fields
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
      condition: { field: 'operation', value: ['instances', 'list_calendars'] },
    },

    // List Calendars Fields
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

    // Invite Attendees Fields
    {
      id: 'attendees',
      title: 'Attendees (comma-separated emails)',
      type: 'short-input',
      placeholder: 'john@example.com, jane@example.com',
      condition: { field: 'operation', value: 'invite' },
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

    // Quick Add Fields
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
      required: true,
    },

    // Notification setting (for create, update, delete, move, quick_add, invite)
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
          default:
            throw new Error(`Invalid Google Calendar operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          credential,
          operation,
          attendees,
          replaceExisting,
          calendarId,
          destinationCalendarId,
          ...rest
        } = params

        // Use canonical 'calendarId' param directly
        const effectiveCalendarId = calendarId ? String(calendarId).trim() : ''

        // Use canonical 'destinationCalendarId' param directly
        const effectiveDestinationCalendarId = destinationCalendarId
          ? String(destinationCalendarId).trim()
          : ''

        const processedParams: Record<string, any> = {
          ...rest,
          calendarId: effectiveCalendarId || 'primary',
        }

        // Add destination calendar ID for move operation
        if (operation === 'move' && effectiveDestinationCalendarId) {
          processedParams.destinationCalendarId = effectiveDestinationCalendarId
        }

        // Convert comma-separated attendees string to array, only if it has content
        if (attendees && typeof attendees === 'string' && attendees.trim().length > 0) {
          const attendeeList = attendees
            .split(',')
            .map((email) => email.trim())
            .filter((email) => email.length > 0)

          // Only add attendees if we have valid entries
          if (attendeeList.length > 0) {
            processedParams.attendees = attendeeList
          }
        }

        // Convert replaceExisting string to boolean for invite operation
        if (operation === 'invite' && replaceExisting !== undefined) {
          processedParams.replaceExisting = replaceExisting === 'true'
        }

        // Set default sendUpdates to 'all' if not specified for operations that support it
        if (
          ['create', 'update', 'delete', 'move', 'quick_add', 'invite'].includes(operation) &&
          !processedParams.sendUpdates
        ) {
          processedParams.sendUpdates = 'all'
        }

        // Convert maxResults to number if provided
        if (processedParams.maxResults && typeof processedParams.maxResults === 'string') {
          processedParams.maxResults = Number.parseInt(processedParams.maxResults, 10)
        }

        // Remove empty minAccessRole
        if (processedParams.minAccessRole === '') {
          processedParams.minAccessRole = undefined
        }

        return {
          credential,
          ...processedParams,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Google Calendar access token' },
    calendarId: { type: 'string', description: 'Calendar identifier (canonical param)' },

    // Create/Update operation inputs
    summary: { type: 'string', description: 'Event title' },
    description: { type: 'string', description: 'Event description' },
    location: { type: 'string', description: 'Event location' },
    startDateTime: { type: 'string', description: 'Event start time' },
    endDateTime: { type: 'string', description: 'Event end time' },
    attendees: { type: 'string', description: 'Attendee email list' },

    // List/Instances operation inputs
    timeMin: { type: 'string', description: 'Start time filter' },
    timeMax: { type: 'string', description: 'End time filter' },
    maxResults: { type: 'string', description: 'Maximum number of results' },

    // Get/Update/Delete/Move/Instances/Invite operation inputs
    eventId: { type: 'string', description: 'Event identifier' },

    // Move operation inputs
    destinationCalendarId: {
      type: 'string',
      description: 'Destination calendar ID (canonical param)',
    },

    // List Calendars operation inputs
    minAccessRole: { type: 'string', description: 'Minimum access role filter' },

    // Quick add inputs
    text: { type: 'string', description: 'Natural language event' },

    // Invite specific inputs
    replaceExisting: { type: 'string', description: 'Replace existing attendees' },

    // Common inputs
    sendUpdates: { type: 'string', description: 'Send email notifications' },
  },
  outputs: {
    content: { type: 'string', description: 'Operation response content' },
    metadata: { type: 'json', description: 'Event or calendar metadata' },
  },
}

export const GoogleCalendarV2Block: BlockConfig<GoogleCalendarResponse> = {
  ...GoogleCalendarBlock,
  type: 'google_calendar_v2',
  name: 'Google Calendar',
  hideFromToolbar: false,
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
    // Event outputs (create, get, update, move, quick_add, invite)
    id: { type: 'string', description: 'Event ID' },
    htmlLink: { type: 'string', description: 'Event link' },
    status: { type: 'string', description: 'Event status' },
    summary: { type: 'string', description: 'Event title' },
    description: { type: 'string', description: 'Event description' },
    location: { type: 'string', description: 'Event location' },
    start: { type: 'json', description: 'Event start' },
    end: { type: 'json', description: 'Event end' },
    attendees: { type: 'json', description: 'Event attendees' },
    creator: { type: 'json', description: 'Event creator' },
    organizer: { type: 'json', description: 'Event organizer' },
    // List events outputs
    events: { type: 'json', description: 'List of events (list operation)' },
    // Delete outputs
    eventId: { type: 'string', description: 'Deleted event ID' },
    deleted: { type: 'boolean', description: 'Whether deletion was successful' },
    // Instances outputs
    instances: { type: 'json', description: 'List of recurring event instances' },
    // List calendars outputs
    calendars: { type: 'json', description: 'List of calendars' },
    // Common outputs
    nextPageToken: { type: 'string', description: 'Next page token' },
    timeZone: { type: 'string', description: 'Calendar time zone' },
  },
}
