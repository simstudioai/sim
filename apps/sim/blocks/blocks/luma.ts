import { LumaIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'

export const LumaBlock: BlockConfig = {
  type: 'luma',
  name: 'Luma',
  description: 'Manage events and guests on Luma',
  longDescription:
    'Integrate Luma into the workflow. Can create events, update events, get event details, list calendar events, get guest lists, and add guests to events.',
  docsLink: 'https://docs.sim.ai/tools/luma',
  category: 'tools',
  bgColor: '#FF5C35',
  icon: LumaIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Event', id: 'get_event' },
        { label: 'Create Event', id: 'create_event' },
        { label: 'Update Event', id: 'update_event' },
        { label: 'List Events', id: 'list_events' },
        { label: 'Get Guests', id: 'get_guests' },
        { label: 'Add Guests', id: 'add_guests' },
      ],
      value: () => 'get_event',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Luma API key',
      password: true,
      required: true,
    },

    // Event ID: used by get_event, update_event, get_guests, add_guests
    {
      id: 'eventId',
      title: 'Event ID',
      type: 'short-input',
      placeholder: 'evt-...',
      required: {
        field: 'operation',
        value: ['get_event', 'update_event', 'get_guests', 'add_guests'],
      },
      condition: {
        field: 'operation',
        value: ['get_event', 'update_event', 'get_guests', 'add_guests'],
      },
    },

    // Event Name: required for create, optional for update
    {
      id: 'name',
      title: 'Event Name',
      type: 'short-input',
      placeholder: 'My Event',
      required: { field: 'operation', value: 'create_event' },
      condition: { field: 'operation', value: ['create_event', 'update_event'] },
    },

    // Start Time: required for create, optional for update
    {
      id: 'startAt',
      title: 'Start Time',
      type: 'short-input',
      placeholder: '2025-03-15T18:00:00Z',
      required: { field: 'operation', value: 'create_event' },
      condition: { field: 'operation', value: ['create_event', 'update_event'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.

Examples:
- "tomorrow at 6pm EST" -> 2025-03-16T18:00:00-05:00
- "next Friday at noon" -> appropriate ISO 8601 date
- "March 20th 2025 at 3pm UTC" -> 2025-03-20T15:00:00Z
- "in 2 weeks at 10am" -> appropriate ISO 8601 date

Return ONLY the ISO 8601 timestamp - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start time (e.g., "next Friday at 6pm EST")...',
        generationType: 'timestamp',
      },
    },

    // Timezone: required for create, optional for update
    {
      id: 'timezone',
      title: 'Timezone',
      type: 'short-input',
      placeholder: 'America/New_York',
      required: { field: 'operation', value: 'create_event' },
      condition: { field: 'operation', value: ['create_event', 'update_event'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate an IANA timezone identifier based on the user's description.

Examples:
- "eastern time" -> America/New_York
- "pacific" -> America/Los_Angeles
- "london" -> Europe/London
- "tokyo" -> Asia/Tokyo
- "central european" -> Europe/Berlin
- "india" -> Asia/Kolkata
- "UTC" -> UTC

Return ONLY the IANA timezone string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the timezone (e.g., "eastern time", "london")...',
      },
    },

    // End Time
    {
      id: 'endAt',
      title: 'End Time',
      type: 'short-input',
      placeholder: '2025-03-15T20:00:00Z',
      condition: { field: 'operation', value: ['create_event', 'update_event'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp for the event end time based on the user's description.

Examples:
- "2 hours after start" -> appropriate ISO 8601 date
- "8pm" -> appropriate ISO 8601 date with 20:00:00
- "March 20th at 5pm UTC" -> 2025-03-20T17:00:00Z

Return ONLY the ISO 8601 timestamp - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end time (e.g., "2 hours after start", "8pm")...',
        generationType: 'timestamp',
      },
    },

    // Duration
    {
      id: 'durationInterval',
      title: 'Duration',
      type: 'short-input',
      placeholder: 'PT2H (2 hours)',
      condition: { field: 'operation', value: ['create_event', 'update_event'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 duration interval based on the user's description.

Examples:
- "2 hours" -> PT2H
- "30 minutes" -> PT30M
- "1 hour 30 minutes" -> PT1H30M
- "3 hours" -> PT3H
- "45 minutes" -> PT45M
- "1 day" -> P1D

Return ONLY the ISO 8601 duration - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the duration (e.g., "2 hours", "90 minutes")...',
      },
    },

    // Description
    {
      id: 'descriptionMd',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Event description (Markdown supported)',
      condition: { field: 'operation', value: ['create_event', 'update_event'] },
    },

    // Meeting URL
    {
      id: 'meetingUrl',
      title: 'Meeting URL',
      type: 'short-input',
      placeholder: 'https://zoom.us/j/...',
      condition: { field: 'operation', value: ['create_event', 'update_event'] },
      mode: 'advanced',
    },

    // Visibility
    {
      id: 'visibility',
      title: 'Visibility',
      type: 'dropdown',
      options: [
        { label: 'Public', id: 'public' },
        { label: 'Members Only', id: 'members-only' },
        { label: 'Private', id: 'private' },
      ],
      condition: { field: 'operation', value: ['create_event', 'update_event'] },
    },

    // Cover Image URL
    {
      id: 'coverUrl',
      title: 'Cover Image URL',
      type: 'short-input',
      placeholder: 'https://images.lumacdn.com/...',
      condition: { field: 'operation', value: ['create_event', 'update_event'] },
      mode: 'advanced',
    },

    // Get Guests: filter
    {
      id: 'approvalStatus',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Approved', id: 'approved' },
        { label: 'Session', id: 'session' },
        { label: 'Pending Approval', id: 'pending_approval' },
        { label: 'Invited', id: 'invited' },
        { label: 'Declined', id: 'declined' },
        { label: 'Waitlist', id: 'waitlist' },
      ],
      condition: { field: 'operation', value: 'get_guests' },
    },

    // Add Guests: guest list
    {
      id: 'guests',
      title: 'Guests',
      type: 'long-input',
      placeholder: '[{"email": "user@example.com", "name": "John Doe"}]',
      required: { field: 'operation', value: 'add_guests' },
      condition: { field: 'operation', value: 'add_guests' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of guest objects for adding to a Luma event.

Each guest object requires an "email" field and optionally "name", "first_name", "last_name".

Examples:
- "add john@example.com" -> [{"email": "john@example.com"}]
- "invite John Doe at john@example.com and Jane Smith at jane@example.com" -> [{"email": "john@example.com", "name": "John Doe"}, {"email": "jane@example.com", "name": "Jane Smith"}]
- "add alice@co.com as Alice Johnson" -> [{"email": "alice@co.com", "first_name": "Alice", "last_name": "Johnson"}]

Return ONLY the JSON array - no explanations, no markdown formatting, no extra text.`,
        placeholder:
          'Describe the guests to add (e.g., "invite john@example.com and jane@example.com")...',
      },
    },

    // List Events: date filters
    {
      id: 'after',
      title: 'After Date',
      type: 'short-input',
      placeholder: '2025-01-01T00:00:00Z',
      condition: { field: 'operation', value: 'list_events' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp for filtering events after this date.

Examples:
- "today" -> current date at 00:00:00Z
- "last week" -> 7 days ago at 00:00:00Z
- "beginning of this month" -> first day of current month at 00:00:00Z
- "January 1st 2025" -> 2025-01-01T00:00:00Z
- "6 months ago" -> appropriate ISO 8601 date

Return ONLY the ISO 8601 timestamp - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start date (e.g., "beginning of this month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'before',
      title: 'Before Date',
      type: 'short-input',
      placeholder: '2025-12-31T23:59:59Z',
      condition: { field: 'operation', value: 'list_events' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp for filtering events before this date.

Examples:
- "end of this month" -> last day of current month at 23:59:59Z
- "next week" -> 7 days from now at 23:59:59Z
- "December 31st 2025" -> 2025-12-31T23:59:59Z
- "tomorrow" -> tomorrow at 23:59:59Z

Return ONLY the ISO 8601 timestamp - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end date (e.g., "end of this month")...',
        generationType: 'timestamp',
      },
    },

    // Shared pagination/sorting (list_events and get_guests)
    {
      id: 'paginationLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max results per page',
      condition: { field: 'operation', value: ['list_events', 'get_guests'] },
      mode: 'advanced',
    },
    {
      id: 'paginationCursor',
      title: 'Pagination Cursor',
      type: 'short-input',
      placeholder: 'Cursor from previous response',
      condition: { field: 'operation', value: ['list_events', 'get_guests'] },
      mode: 'advanced',
    },
    {
      id: 'sortColumn',
      title: 'Sort By',
      type: 'short-input',
      placeholder: 'e.g., start_at, name, registered_at',
      condition: { field: 'operation', value: ['list_events', 'get_guests'] },
      mode: 'advanced',
    },
    {
      id: 'sortDirection',
      title: 'Sort Direction',
      type: 'dropdown',
      options: [
        { label: 'Ascending', id: 'asc' },
        { label: 'Descending', id: 'desc' },
      ],
      condition: { field: 'operation', value: ['list_events', 'get_guests'] },
      mode: 'advanced',
    },
  ],

  tools: {
    access: [
      'luma_get_event',
      'luma_create_event',
      'luma_update_event',
      'luma_list_events',
      'luma_get_guests',
      'luma_add_guests',
    ],
    config: {
      tool: (params) => `luma_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.paginationLimit) result.paginationLimit = Number(params.paginationLimit)
        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Luma API key' },
    eventId: { type: 'string', description: 'Event ID (starts with evt-)' },
    name: { type: 'string', description: 'Event name' },
    startAt: { type: 'string', description: 'Event start time (ISO 8601)' },
    timezone: { type: 'string', description: 'Event timezone (IANA)' },
    durationInterval: { type: 'string', description: 'Event duration (ISO 8601 interval)' },
    endAt: { type: 'string', description: 'Event end time (ISO 8601)' },
    descriptionMd: { type: 'string', description: 'Event description (Markdown)' },
    meetingUrl: { type: 'string', description: 'Virtual meeting URL' },
    visibility: { type: 'string', description: 'Event visibility' },
    coverUrl: { type: 'string', description: 'Cover image URL (Luma CDN)' },
    approvalStatus: { type: 'string', description: 'Guest approval status filter' },
    guests: { type: 'string', description: 'JSON array of guest objects' },
    after: { type: 'string', description: 'Filter events after this date (ISO 8601)' },
    before: { type: 'string', description: 'Filter events before this date (ISO 8601)' },
    paginationLimit: { type: 'number', description: 'Max results per page' },
    paginationCursor: { type: 'string', description: 'Pagination cursor from previous response' },
    sortColumn: { type: 'string', description: 'Column to sort by' },
    sortDirection: { type: 'string', description: 'Sort direction (asc or desc)' },
  },

  outputs: {
    event: { type: 'json', description: 'Event details' },
    hosts: { type: 'json', description: 'Event hosts' },
    events: { type: 'json', description: 'List of events' },
    guests: { type: 'json', description: 'List of guests' },
    hasMore: { type: 'boolean', description: 'Whether more results are available' },
    nextCursor: { type: 'string', description: 'Pagination cursor for next page' },
  },
}
