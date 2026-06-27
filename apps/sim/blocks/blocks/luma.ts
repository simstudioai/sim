import { LumaIcon } from '@/components/icons'
import { LumaBlockDisplay } from '@/blocks/blocks/luma.display'
import { AuthMode, type BlockConfig, type BlockMeta } from '@/blocks/types'

export const LumaBlock: BlockConfig = {
  ...LumaBlockDisplay,
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
        { label: 'Lookup Event', id: 'lookup_event' },
        { label: 'Cancel Event', id: 'cancel_event' },
        { label: 'Get Guests', id: 'get_guests' },
        { label: 'Get Guest', id: 'get_guest' },
        { label: 'Add Guests', id: 'add_guests' },
        { label: 'Send Invites', id: 'send_invites' },
        { label: 'Update Guest Status', id: 'update_guest_status' },
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

    // Event ID: used by most operations. Required for all except lookup_event,
    // where it is an optional alternative to the event URL.
    {
      id: 'eventId',
      title: 'Event ID',
      type: 'short-input',
      placeholder: 'evt-...',
      required: {
        field: 'operation',
        value: [
          'get_event',
          'update_event',
          'get_guests',
          'get_guest',
          'add_guests',
          'send_invites',
          'update_guest_status',
          'cancel_event',
        ],
      },
      condition: {
        field: 'operation',
        value: [
          'get_event',
          'update_event',
          'get_guests',
          'get_guest',
          'add_guests',
          'send_invites',
          'update_guest_status',
          'cancel_event',
          'lookup_event',
        ],
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

    // Add Guests / Send Invites: guest list
    {
      id: 'guests',
      title: 'Guests',
      type: 'long-input',
      placeholder: '[{"email": "user@example.com", "name": "John Doe"}]',
      required: { field: 'operation', value: ['add_guests', 'send_invites'] },
      condition: { field: 'operation', value: ['add_guests', 'send_invites'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of guest objects for a Luma event.

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

    // Send Invites: optional custom message
    {
      id: 'message',
      title: 'Invite Message',
      type: 'long-input',
      placeholder: 'Optional message included in the invite email (max 200 characters)',
      condition: { field: 'operation', value: 'send_invites' },
    },

    // Get Guest / Update Guest Status: guest identifier
    {
      id: 'guestIdentifier',
      title: 'Guest',
      type: 'short-input',
      placeholder: 'guest@example.com or gst-...',
      required: { field: 'operation', value: ['get_guest', 'update_guest_status'] },
      condition: { field: 'operation', value: ['get_guest', 'update_guest_status'] },
    },

    // Update Guest Status: new status
    {
      id: 'status',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'Approved', id: 'approved' },
        { label: 'Declined', id: 'declined' },
        { label: 'Pending Approval', id: 'pending_approval' },
        { label: 'Waitlist', id: 'waitlist' },
      ],
      required: { field: 'operation', value: 'update_guest_status' },
      condition: { field: 'operation', value: 'update_guest_status' },
      value: () => 'approved',
    },

    // Update Guest Status: send email toggle
    {
      id: 'sendEmail',
      title: 'Notify Guest',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      condition: { field: 'operation', value: 'update_guest_status' },
      mode: 'advanced',
    },

    // Cancel Event: cancellation token
    {
      id: 'cancellationToken',
      title: 'Cancellation Token',
      type: 'short-input',
      placeholder: 'Token from the cancellation request',
      password: true,
      required: { field: 'operation', value: 'cancel_event' },
      condition: { field: 'operation', value: 'cancel_event' },
    },

    // Refund toggle: used by update_guest_status and cancel_event
    {
      id: 'shouldRefund',
      title: 'Refund Paid Guests',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      condition: { field: 'operation', value: ['update_guest_status', 'cancel_event'] },
      mode: 'advanced',
    },

    // Lookup Event: event URL
    {
      id: 'url',
      title: 'Event URL',
      type: 'short-input',
      placeholder: 'https://lu.ma/...',
      condition: { field: 'operation', value: 'lookup_event' },
    },

    // Lookup Event: platform
    {
      id: 'platform',
      title: 'Platform',
      type: 'dropdown',
      options: [
        { label: 'Luma', id: 'luma' },
        { label: 'External', id: 'external' },
      ],
      condition: { field: 'operation', value: 'lookup_event' },
      mode: 'advanced',
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
      'luma_lookup_event',
      'luma_cancel_event',
      'luma_get_guests',
      'luma_get_guest',
      'luma_add_guests',
      'luma_send_invites',
      'luma_update_guest_status',
    ],
    config: {
      tool: (params) => `luma_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.paginationLimit) result.paginationLimit = Number(params.paginationLimit)
        if (params.shouldRefund !== undefined && params.shouldRefund !== '') {
          result.shouldRefund = params.shouldRefund === 'true' || params.shouldRefund === true
        }
        if (params.sendEmail !== undefined && params.sendEmail !== '') {
          result.sendEmail = params.sendEmail === 'true' || params.sendEmail === true
        }
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
    message: { type: 'string', description: 'Custom message for the invite email' },
    guestIdentifier: { type: 'string', description: 'Guest email address or guest ID' },
    status: { type: 'string', description: 'New guest approval status' },
    sendEmail: { type: 'boolean', description: 'Whether to email the guest about the change' },
    cancellationToken: { type: 'string', description: 'Token to authorize event cancellation' },
    shouldRefund: { type: 'boolean', description: 'Whether to refund paid guests' },
    url: { type: 'string', description: 'Public event URL to look up' },
    platform: { type: 'string', description: 'Event platform (luma or external)' },
    after: { type: 'string', description: 'Filter events after this date (ISO 8601)' },
    before: { type: 'string', description: 'Filter events before this date (ISO 8601)' },
    paginationLimit: { type: 'number', description: 'Max results per page' },
    paginationCursor: { type: 'string', description: 'Pagination cursor from previous response' },
    sortColumn: { type: 'string', description: 'Column to sort by' },
    sortDirection: { type: 'string', description: 'Sort direction (asc or desc)' },
  },

  outputs: {
    event: {
      type: 'json',
      description:
        'Event details (id, name, startAt, endAt, timezone, durationInterval, createdAt, description, descriptionMd, coverUrl, url, visibility, meetingUrl, geoAddressJson, geoLatitude, geoLongitude, calendarId)',
    },
    hosts: {
      type: 'json',
      description: 'Event hosts (id, name, firstName, lastName, email, avatarUrl)',
    },
    events: {
      type: 'json',
      description:
        'List of events, each with id, name, startAt, endAt, timezone, durationInterval, createdAt, description, descriptionMd, coverUrl, url, visibility, meetingUrl, geoAddressJson, geoLatitude, geoLongitude, calendarId',
    },
    guests: {
      type: 'json',
      description:
        'List of guests (id, email, name, firstName, lastName, approvalStatus, registeredAt, invitedAt, joinedAt, checkedInAt, phoneNumber)',
    },
    guest: {
      type: 'json',
      description:
        'Single guest (id, email, name, firstName, lastName, approvalStatus, registeredAt, invitedAt, joinedAt, checkedInAt, phoneNumber)',
    },
    hasMore: { type: 'boolean', description: 'Whether more results are available' },
    nextCursor: { type: 'string', description: 'Pagination cursor for next page' },
    added: { type: 'number', description: 'Number of guests added (Add Guests operation)' },
    invited: { type: 'number', description: 'Number of guests invited (Send Invites operation)' },
    status: { type: 'string', description: 'Applied guest status or looked-up event status' },
    cancelled: { type: 'boolean', description: 'Whether the event was cancelled' },
    found: { type: 'boolean', description: 'Whether a matching event was found (Lookup Event)' },
    eventId: { type: 'string', description: 'Resolved event ID (Lookup Event operation)' },
    apiId: { type: 'string', description: 'Resolved event API ID (Lookup Event operation)' },
  },
}

export const LumaBlockMeta = {
  tags: ['events', 'calendar', 'scheduling'],
  url: 'https://luma.com',
  templates: [
    {
      icon: LumaIcon,
      title: 'Luma event reminder cadence',
      prompt:
        'Create a workflow that sends scheduled reminders to Luma event registrants — 7 days, 24 hours, 1 hour out — with personalized content based on RSVP type.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'communication'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: LumaIcon,
      title: 'Luma registrant enricher',
      prompt:
        'Build a scheduled workflow that pulls the Luma event guest list, enriches each registrant with company data via Apollo, and pushes high-value attendees into HubSpot as leads.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'crm'],
      alsoIntegrations: ['apollo', 'hubspot'],
    },
    {
      icon: LumaIcon,
      title: 'Luma post-event followup',
      prompt:
        'Create a scheduled workflow that runs the day after a Luma event, pulls the guest list, segments attendees from no-shows, sends each segment a tailored followup, and writes attendance to the CRM.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'crm'],
      alsoIntegrations: ['gmail', 'hubspot'],
    },
    {
      icon: LumaIcon,
      title: 'Luma calendar import',
      prompt:
        'Build a scheduled workflow that pulls the Luma event guest list and creates a personalized Google Calendar invite for each new registrant with the event details, location, and prep links.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'automation'],
      alsoIntegrations: ['google_calendar'],
    },
    {
      icon: LumaIcon,
      title: 'Luma + Discord community sync',
      prompt:
        'Create a scheduled workflow that pulls the Luma event guest list and adds each new registrant to the matching Discord community channel with the right role for event access.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['community', 'communication'],
      alsoIntegrations: ['discord'],
    },
    {
      icon: LumaIcon,
      title: 'Luma event-series analytics',
      prompt:
        'Build a scheduled workflow that pulls Luma event-series data, calculates conversion from registration to attendance to next action, and writes the analytics to a report file.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
    },
    {
      icon: LumaIcon,
      title: 'Luma new-registrant welcome',
      prompt:
        'Create a scheduled workflow that pulls the Luma event guest list, finds registrants added since the last run, and sends each a personalized welcome email with what to expect and how to prepare.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'create-event',
      description:
        'Create a Luma event with a name, start time, timezone, description, and visibility.',
      content:
        '# Create Event\n\nSpin up a new Luma event ready to share.\n\n## Steps\n1. Decide the event name, start time as an ISO 8601 timestamp, and the IANA timezone.\n2. Create Event with those fields plus an optional end time or duration, a Markdown description, and a meeting URL for virtual events.\n3. Set visibility to public, members-only, or private as appropriate.\n\n## Output\nThe created event ID and URL, with its start time, timezone, and visibility.',
    },
    {
      name: 'add-guests-to-event',
      description: 'Add a batch of guests to a Luma event from a list of emails and names.',
      content:
        '# Add Guests to Event\n\nBulk-register guests on a Luma event.\n\n## Steps\n1. Confirm the target event ID.\n2. Build the guests JSON array, one object per guest with an email and optional name or first and last name.\n3. Add Guests with the event ID and the guest array.\n\n## Output\nConfirmation of how many guests were added and the event ID they were added to.',
    },
    {
      name: 'export-guest-list',
      description:
        'Pull a Luma event guest list, optionally filtered by approval status, for follow-up or enrichment.',
      content:
        '# Export Guest List\n\nRetrieve registrants for an event.\n\n## Steps\n1. Get Guests for the event ID, optionally filtering by approval status such as approved or waitlist.\n2. Page through results using the limit and pagination cursor until the full list is collected.\n3. Extract the fields you need, such as email, name, approval status, and registered or checked-in timestamps.\n\n## Output\nThe full guest list with key fields, ready to segment attendees from no-shows or feed into a CRM.',
    },
    {
      name: 'send-event-reminders',
      description:
        'Pull the Luma guest list and prepare personalized reminders for upcoming registrants.',
      content:
        '# Send Event Reminders\n\nPrepare reminder content for an upcoming Luma event.\n\n## Steps\n1. Get Event to read the name, start time, timezone, and meeting or location details.\n2. Get Guests filtered to approved registrants, paging until complete.\n3. For each guest, draft a personalized reminder with the event time in their context and the join or location info.\n\n## Output\nA per-guest list of email addresses and drafted reminder messages, ready to hand to an email or messaging step.',
    },
    {
      name: 'triage-event-registrations',
      description:
        'Review pending Luma registrations and approve, waitlist, or decline each guest.',
      content:
        '# Triage Event Registrations\n\nProcess pending registrations for an event with limited capacity.\n\n## Steps\n1. Get Guests filtered to the pending_approval status, paging until complete.\n2. Apply your approval criteria to each registrant (for example, work email domain or registration answers).\n3. Update Guest Status for each guest to approved, waitlist, or declined, identifying them by email or guest ID.\n\n## Output\nEach pending guest moved to a final approval status, with the applied status reported back per guest.',
    },
    {
      name: 'invite-guests-to-event',
      description:
        'Email Luma event invitations to a list of prospects with an optional custom message.',
      content:
        '# Invite Guests to Event\n\nSend invitations that recipients can accept, rather than registering them outright.\n\n## Steps\n1. Confirm the target event ID.\n2. Build a guests JSON array, one object per invitee with an email and optional name.\n3. Send Invites with the event ID, the guest array, and an optional short message.\n\n## Output\nThe count of guests invited, ready to log or report.',
    },
  ],
} as const satisfies BlockMeta
