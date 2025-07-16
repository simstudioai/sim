import { GoogleCalendarIcon } from '@/components/icons'
import type {
  GoogleCalendarCreateResponse,
  GoogleCalendarGetResponse,
  GoogleCalendarInviteResponse,
  GoogleCalendarListResponse,
  GoogleCalendarQuickAddResponse,
} from '@/tools/google_calendar/types'
import type { BlockConfig } from '../types'

type GoogleCalendarResponse =
  | GoogleCalendarCreateResponse
  | GoogleCalendarListResponse
  | GoogleCalendarGetResponse
  | GoogleCalendarQuickAddResponse
  | GoogleCalendarInviteResponse

export const GoogleCalendarBlock: BlockConfig<GoogleCalendarResponse> = {
  type: 'google_calendar',
  name: 'Google Calendar',
  description: 'Manage Google Calendar events',
  longDescription:
    "Integrate Google Calendar functionality to create, read, update, and list calendar events within your workflow. Automate scheduling, check availability, and manage events using OAuth authentication. Email invitations are sent asynchronously and delivery depends on recipients' Google Calendar settings.",
  docsLink: 'https://docs.simstudio.ai/tools/google_calendar',
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
    },
    {
      id: 'credential',
      title: 'Google Calendar Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'google-calendar',
      serviceId: 'google-calendar',
      requiredScopes: ['https://www.googleapis.com/auth/calendar'],
      placeholder: 'Select Google Calendar account',
    },
    {
      id: 'calendarId',
      title: 'Calendar',
      type: 'file-selector',
      layout: 'full',
      provider: 'google-calendar',
      serviceId: 'google-calendar',
      requiredScopes: ['https://www.googleapis.com/auth/calendar'],
      placeholder: 'Select calendar',
    },

    // Create Event Fields
    {
      id: 'summary',
      title: 'Event Title',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Meeting with team',
      condition: { field: 'operation', value: 'create' },
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
    },
    {
      id: 'endDateTime',
      title: 'End Date & Time',
      type: 'short-input',
      layout: 'half',
      placeholder: '2025-06-03T11:00:00-08:00',
      condition: { field: 'operation', value: 'create' },
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
    },
    {
      id: 'attendees',
      title: 'Attendees (comma-separated emails)',
      type: 'short-input',
      layout: 'full',
      placeholder: 'john@example.com, jane@example.com',
      condition: { field: 'operation', value: 'quick_add' },
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
        const { credential, operation, attendees, replaceExisting, ...rest } = params

        const processedParams = { ...rest }

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
          accessToken: credential,
          ...processedParams,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    calendarId: { type: 'string', required: false },

    // Create operation inputs
    summary: { type: 'string', required: false },
    description: { type: 'string', required: false },
    location: { type: 'string', required: false },
    startDateTime: { type: 'string', required: false },
    endDateTime: { type: 'string', required: false },
    attendees: { type: 'string', required: false },

    // List operation inputs
    timeMin: { type: 'string', required: false },
    timeMax: { type: 'string', required: false },

    // Get/Invite operation inputs
    eventId: { type: 'string', required: false },

    // Quick add inputs
    text: { type: 'string', required: false },

    // Invite specific inputs
    replaceExisting: { type: 'string', required: false },

    // Common inputs
    sendUpdates: { type: 'string', required: false },
  },
  outputs: {
    content: 'string',
    metadata: 'json',
  },
}
