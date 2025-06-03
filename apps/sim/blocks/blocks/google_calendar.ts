import { GoogleCalendarIcon } from '@/components/icons'
import type {
  GoogleCalendarCreateResponse,
  GoogleCalendarGetResponse,
  GoogleCalendarListResponse,
  GoogleCalendarQuickAddResponse,
  GoogleCalendarUpdateResponse,
} from '@/tools/google_calendar/types'
import type { BlockConfig } from '../types'

type GoogleCalendarResponse =
  | GoogleCalendarCreateResponse
  | GoogleCalendarListResponse
  | GoogleCalendarGetResponse
  | GoogleCalendarQuickAddResponse
  | GoogleCalendarUpdateResponse

export const GoogleCalendarBlock: BlockConfig<GoogleCalendarResponse> = {
  type: 'google_calendar',
  name: 'Google Calendar',
  description: 'Manage Google Calendar events',
  longDescription:
    'Integrate Google Calendar functionality to create, read, update, and list calendar events within your workflow. Automate scheduling, check availability, and manage events using OAuth authentication.',
  docsLink: 'https://docs.simstudio.ai/tools/google-calendar',
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
      placeholder: 'Event ID to retrieve',
      condition: { field: 'operation', value: 'get' },
    },

    // Update Event Fields
    {
      id: 'eventId',
      title: 'Event ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Event ID to update',
      condition: { field: 'operation', value: 'update' },
    },
    {
      id: 'summary',
      title: 'Event Title',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Updated meeting title',
      condition: { field: 'operation', value: 'update' },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Updated description',
      condition: { field: 'operation', value: 'update' },
    },
    {
      id: 'location',
      title: 'Location',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Updated location',
      condition: { field: 'operation', value: 'update' },
    },
    {
      id: 'startDateTime',
      title: 'Start Date & Time',
      type: 'short-input',
      layout: 'half',
      placeholder: '2025-06-03T10:00:00-08:00',
      condition: { field: 'operation', value: 'update' },
    },
    {
      id: 'endDateTime',
      title: 'End Date & Time',
      type: 'short-input',
      layout: 'half',
      placeholder: '2025-06-03T11:00:00-08:00',
      condition: { field: 'operation', value: 'update' },
    },
    {
      id: 'attendees',
      title: 'Attendees (comma-separated emails)',
      type: 'short-input',
      layout: 'full',
      placeholder: 'john@example.com, jane@example.com',
      condition: { field: 'operation', value: 'update' },
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

    // Notification setting (for create, update, quick_add)
    {
      id: 'sendUpdates',
      title: 'Send Email Notifications',
      type: 'dropdown',
      layout: 'full',
      condition: {
        field: 'operation',
        value: ['create', 'update', 'quick_add'],
      },
      options: [
        { label: 'All', id: 'all' },
        { label: 'External Only', id: 'externalOnly' },
        { label: 'None', id: 'none' },
      ],
    },
  ],
  tools: {
    access: [
      'google_calendar_create',
      'google_calendar_list',
      'google_calendar_get',
      'google_calendar_quick_add',
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
          default:
            throw new Error(`Invalid Google Calendar operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { credential, operation, attendees, ...rest } = params

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

        // Set default sendUpdates to 'all' if not specified for operations that support it
        if (['create', 'update', 'quick_add'].includes(operation) && !processedParams.sendUpdates) {
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

    // Get/Update operation inputs
    eventId: { type: 'string', required: false },

    // Quick add inputs
    text: { type: 'string', required: false },

    // Common inputs
    sendUpdates: { type: 'string', required: false },
  },
  outputs: {
    response: {
      type: {
        content: 'string',
        metadata: 'json',
      },
    },
  },
}
