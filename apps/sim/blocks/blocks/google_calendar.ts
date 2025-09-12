import { GoogleCalendarIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { GoogleCalendarResponse } from '@/tools/google_calendar/types'

export const GoogleCalendarBlock: BlockConfig<GoogleCalendarResponse> = {
  type: 'google_calendar',
  name: 'Google Calendar',
  description: 'Manage Google Calendar events',
  longDescription:
    'Integrate Google Calendar into the workflow. Can create, read, update, and list calendar events. Requires OAuth.',
  docsLink: 'https://docs.sim.ai/tools/google_calendar',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: GoogleCalendarIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Create Event', id: 'create' },
        { label: 'List Events', id: 'list' },
        { label: 'Get Event', id: 'get' },
        { label: 'Quick Add (Natural Language)', id: 'quick_add' },
        { label: 'Invite Attendees', id: 'invite' },
      ],
      value: () => 'create',
    },
    {
      id: 'credential',
      title: 'Google Calendar Account',
      type: 'oauth-input',
      layout: 'full',
      required: true,
      provider: 'google-calendar',
      serviceId: 'google-calendar',
      requiredScopes: ['https://www.googleapis.com/auth/calendar'],
      placeholder: 'Select Google Calendar account',
    },
    // Calendar selector (basic mode)
    {
      id: 'calendarId',
      title: 'Calendar',
      type: 'file-selector',
      layout: 'full',
      canonicalParamId: 'calendarId',
      provider: 'google-calendar',
      serviceId: 'google-calendar',
      requiredScopes: ['https://www.googleapis.com/auth/calendar'],
      placeholder: 'Select calendar',
      dependsOn: ['credential'],
      mode: 'basic',
    },
    // Manual calendar ID input (advanced mode)
    {
      id: 'manualCalendarId',
      title: 'Calendar ID',
      type: 'short-input',
      layout: 'full',
      canonicalParamId: 'calendarId',
      placeholder: 'Enter calendar ID (e.g., primary or calendar@gmail.com)',
      mode: 'advanced',
    },

    // Create Event Fields
    {
      id: 'summary',
      title: 'Event Title',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Meeting with team',
      condition: { field: 'operation', value: 'create' },
      required: true,
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Event description',
      condition: { field: 'operation', value: 'create' },
    },
    {
      id: 'location',
      title: 'Location',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Conference Room A',
      condition: { field: 'operation', value: 'create' },
    },
    {
      id: 'startDateTime',
      title: 'Start Date & Time',
      type: 'short-input',
      layout: 'half',
      placeholder: '2025-06-03T10:00:00-08:00',
      condition: { field: 'operation', value: 'create' },
      required: true,
    },
    {
      id: 'endDateTime',
      title: 'End Date & Time',
      type: 'short-input',
      layout: 'half',
      placeholder: '2025-06-03T11:00:00-08:00',
      condition: { field: 'operation', value: 'create' },
      required: true,
    },
    {
      id: 'attendees',
      title: 'Attendees (comma-separated emails)',
      type: 'short-input',
      layout: 'full',
      placeholder: 'john@example.com, jane@example.com',
      condition: { field: 'operation', value: 'create' },
    },

    // List Events Fields
    {
      id: 'timeMin',
      title: 'Start Time Filter',
      type: 'short-input',
      layout: 'half',
      placeholder: '2025-06-03T00:00:00Z',
      condition: { field: 'operation', value: 'list' },
    },
    {
      id: 'timeMax',
      title: 'End Time Filter',
      type: 'short-input',
      layout: 'half',
      placeholder: '2025-06-04T00:00:00Z',
      condition: { field: 'operation', value: 'list' },
    },

    // Get Event Fields
    {
      id: 'eventId',
      title: 'Event ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Event ID',
      condition: { field: 'operation', value: ['get', 'invite'] },
      required: true,
    },

    // Invite Attendees Fields
    {
      id: 'attendees',
      title: 'Attendees (comma-separated emails)',
      type: 'short-input',
      layout: 'full',
      placeholder: 'john@example.com, jane@example.com',
      condition: { field: 'operation', value: 'invite' },
    },
    {
      id: 'replaceExisting',
      title: 'Replace Existing Attendees',
      type: 'dropdown',
      layout: 'full',
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
      layout: 'full',
      placeholder: 'Meeting with John tomorrow at 3pm for 1 hour',
      condition: { field: 'operation', value: 'quick_add' },
      required: true,
    },
    {
      id: 'attendees',
      title: 'Attendees (comma-separated emails)',
      type: 'short-input',
      layout: 'full',
      placeholder: 'john@example.com, jane@example.com',
      condition: { field: 'operation', value: 'quick_add' },
      required: true,
    },

    // Notification setting (for create, quick_add, invite)
    {
      id: 'sendUpdates',
      title: 'Send Email Notifications',
      type: 'dropdown',
      layout: 'full',
      condition: {
        field: 'operation',
        value: ['create', 'quick_add', 'invite'],
      },
      options: [
        { label: 'All attendees (recommended)', id: 'all' },
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
          manualCalendarId,
          ...rest
        } = params

        // Handle calendar ID (selector or manual)
        const effectiveCalendarId = (calendarId || manualCalendarId || '').trim()

        const processedParams: Record<string, any> = {
          ...rest,
          calendarId: effectiveCalendarId || 'primary',
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
        if (['create', 'quick_add', 'invite'].includes(operation) && !processedParams.sendUpdates) {
          processedParams.sendUpdates = 'all'
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
    calendarId: { type: 'string', description: 'Calendar identifier' },
    manualCalendarId: { type: 'string', description: 'Manual calendar identifier' },

    // Create operation inputs
    summary: { type: 'string', description: 'Event title' },
    description: { type: 'string', description: 'Event description' },
    location: { type: 'string', description: 'Event location' },
    startDateTime: { type: 'string', description: 'Event start time' },
    endDateTime: { type: 'string', description: 'Event end time' },
    attendees: { type: 'string', description: 'Attendee email list' },

    // List operation inputs
    timeMin: { type: 'string', description: 'Start time filter' },
    timeMax: { type: 'string', description: 'End time filter' },

    // Get/Invite operation inputs
    eventId: { type: 'string', description: 'Event identifier' },

    // Quick add inputs
    text: { type: 'string', description: 'Natural language event' },

    // Invite specific inputs
    replaceExisting: { type: 'string', description: 'Replace existing attendees' },

    // Common inputs
    sendUpdates: { type: 'string', description: 'Send email notifications' },
  },
  outputs: {
    content: { type: 'string', description: 'Operation response content' },
    metadata: { type: 'json', description: 'Event metadata' },
  },
}
