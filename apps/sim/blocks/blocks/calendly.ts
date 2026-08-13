import { getErrorMessage } from '@sim/utils/errors'
import { CalendlyIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { ToolResponse } from '@/tools/types'
import { getTrigger } from '@/triggers'

/**
 * The list endpoints scope by a user URI or an organization URI, never both, so
 * the clause takes whichever the user filled.
 */
const SCOPE_FIELD = ['user', 'organization'] as const

/**
 * A `json` field arrives as text the user typed, but as a real array when an upstream block is
 * referenced, so only the text form is parsed.
 */
function parseJsonArray(value: unknown, field: string): unknown {
  if (typeof value !== 'string') return value

  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(`Invalid JSON input for ${field}: ${getErrorMessage(error)}`)
  }
}

export const CalendlyBlock: BlockConfig<ToolResponse> = {
  type: 'calendly',
  name: 'Calendly',
  description: 'Manage Calendly scheduling and events',
  authMode: AuthMode.ApiKey,
  triggerAllowed: true,
  longDescription:
    'Integrate Calendly into your workflow. Manage event types, scheduled events, invitees, and webhooks. Can also trigger workflows based on Calendly webhook events (invitee scheduled, invitee canceled, routing form submitted). Requires Personal Access Token.',
  docsLink: 'https://docs.sim.ai/integrations/calendly',
  category: 'tools',
  integrationType: IntegrationType.Productivity,
  bgColor: '#FFFFFF',
  icon: CalendlyIcon,
  canvasPresentation: {
    defaultTitle: 'Calendly',
    triggerSentences: {
      byTrigger: {
        calendly_webhook: ['Run on any scheduling event'],
      },
    },
    sentences: {
      byOperation: {
        calendly_get_current_user: ['Read the connected account profile'],
        calendly_get_user: [{ text: 'Read user', field: 'userUuid', core: true }],
        calendly_list_event_types: ['List event types', { text: ', for', field: SCOPE_FIELD }],
        calendly_get_event_type: [{ text: 'Read event type', field: 'eventTypeUuid', core: true }],
        calendly_list_event_type_available_times: [
          { text: 'List open slots for event type', field: 'eventTypeUri', core: true },
          { text: ', from', field: 'startTime' },
          { text: ', until', field: 'endTime' },
        ],
        calendly_list_scheduled_events: [
          'List scheduled events',
          { text: ', for', field: SCOPE_FIELD },
          { text: ', with invitee', field: 'invitee_email' },
          { text: ', starting after', field: 'min_start_time' },
        ],
        calendly_get_scheduled_event: [
          { text: 'Read scheduled event', field: 'eventUuid', core: true },
        ],
        calendly_list_event_invitees: [
          { text: 'List invitees of event', field: 'eventUuid', core: true },
          { text: ', matching', field: 'email' },
          { text: ', with status', field: 'status' },
        ],
        calendly_get_event_invitee: [
          { text: 'Read invitee', field: 'inviteeUuid', core: true },
          { text: ', of event', field: 'eventUuid' },
        ],
        calendly_create_event_invitee: [
          { text: 'Book event type', field: 'eventTypeUri', core: true },
          { text: ', for', field: 'inviteeEmail' },
          { text: ', at', field: 'startTime' },
        ],
        calendly_cancel_event: [
          { text: 'Cancel event', field: 'eventUuid', core: true },
          { text: ', with reason', field: 'reason' },
        ],
        calendly_create_invitee_no_show: [
          { text: 'Mark invitee as a no-show', field: 'inviteeUri', core: true },
        ],
        calendly_delete_invitee_no_show: [
          { text: 'Remove no-show', field: 'noShowUuid', core: true },
        ],
        calendly_create_scheduling_link: [
          { text: 'Create a single-use link for event type', field: 'eventTypeUri', core: true },
        ],
        calendly_list_user_busy_times: [
          { text: 'List busy times for', field: 'user', core: true },
          { text: ', from', field: 'startTime' },
          { text: ', until', field: 'endTime' },
        ],
        calendly_list_user_availability_schedules: [
          { text: 'List availability schedules for', field: 'user', core: true },
        ],
        calendly_list_organization_memberships: [
          'List organization members',
          { text: ', in', field: 'organization' },
          { text: ', with role', field: 'role' },
          { text: ', matching', field: 'email' },
        ],
        calendly_list_routing_forms: [
          { text: 'List routing forms of', field: 'organization', core: true },
        ],
        calendly_list_routing_form_submissions: [
          { text: 'List submissions of routing form', field: 'formUri', core: true },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Current User', id: 'calendly_get_current_user' },
        { label: 'Get User', id: 'calendly_get_user' },
        { label: 'List Event Types', id: 'calendly_list_event_types' },
        { label: 'Get Event Type', id: 'calendly_get_event_type' },
        {
          label: 'List Event Type Available Times',
          id: 'calendly_list_event_type_available_times',
        },
        { label: 'List Scheduled Events', id: 'calendly_list_scheduled_events' },
        { label: 'Get Scheduled Event', id: 'calendly_get_scheduled_event' },
        { label: 'List Event Invitees', id: 'calendly_list_event_invitees' },
        { label: 'Get Event Invitee', id: 'calendly_get_event_invitee' },
        { label: 'Book Meeting', id: 'calendly_create_event_invitee' },
        { label: 'Cancel Event', id: 'calendly_cancel_event' },
        { label: 'Mark Invitee No-Show', id: 'calendly_create_invitee_no_show' },
        { label: 'Unmark Invitee No-Show', id: 'calendly_delete_invitee_no_show' },
        { label: 'Create Scheduling Link', id: 'calendly_create_scheduling_link' },
        { label: 'List User Busy Times', id: 'calendly_list_user_busy_times' },
        {
          label: 'List User Availability Schedules',
          id: 'calendly_list_user_availability_schedules',
        },
        { label: 'List Organization Memberships', id: 'calendly_list_organization_memberships' },
        { label: 'List Routing Forms', id: 'calendly_list_routing_forms' },
        { label: 'List Routing Form Submissions', id: 'calendly_list_routing_form_submissions' },
      ],
      value: () => 'calendly_list_scheduled_events',
    },
    {
      id: 'apiKey',
      title: 'Personal Access Token',
      type: 'short-input',
      placeholder: 'Enter your Calendly personal access token',
      password: true,
      required: true,
    },
    {
      id: 'userUuid',
      title: 'User UUID',
      type: 'short-input',
      placeholder: 'Enter user UUID or URI, or "me"',
      required: true,
      condition: { field: 'operation', value: 'calendly_get_user' },
    },
    {
      id: 'eventTypeUuid',
      title: 'Event Type UUID',
      type: 'short-input',
      placeholder: 'Enter event type UUID or URI',
      required: true,
      condition: { field: 'operation', value: 'calendly_get_event_type' },
    },
    {
      id: 'eventTypeUri',
      title: 'Event Type',
      type: 'short-input',
      placeholder: 'Enter event type UUID or URI',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'calendly_list_event_type_available_times',
          'calendly_create_event_invitee',
          'calendly_create_scheduling_link',
        ],
      },
    },
    {
      id: 'user',
      title: 'User URI',
      type: 'short-input',
      placeholder: 'Enter user UUID or URI',
      required: {
        field: 'operation',
        value: ['calendly_list_user_busy_times', 'calendly_list_user_availability_schedules'],
      },
      condition: {
        field: 'operation',
        value: [
          'calendly_list_event_types',
          'calendly_list_scheduled_events',
          'calendly_list_user_busy_times',
          'calendly_list_user_availability_schedules',
          'calendly_list_organization_memberships',
        ],
      },
    },
    {
      id: 'organization',
      title: 'Organization URI',
      type: 'short-input',
      placeholder: 'Enter organization UUID or URI',
      required: { field: 'operation', value: 'calendly_list_routing_forms' },
      condition: {
        field: 'operation',
        value: [
          'calendly_list_event_types',
          'calendly_list_scheduled_events',
          'calendly_list_organization_memberships',
          'calendly_list_routing_forms',
        ],
      },
    },
    {
      id: 'active',
      title: 'Active Only',
      type: 'switch',
      description:
        'When enabled, shows only active event types. When disabled, shows all event types.',
      condition: { field: 'operation', value: 'calendly_list_event_types' },
    },
    {
      id: 'invitee_email',
      title: 'Invitee Email',
      type: 'short-input',
      placeholder: 'Filter by invitee email',
      condition: { field: 'operation', value: 'calendly_list_scheduled_events' },
    },
    {
      id: 'min_start_time',
      title: 'Min Start Time',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'ISO 8601 format (e.g., 2024-01-01T00:00:00Z)',
      condition: { field: 'operation', value: 'calendly_list_scheduled_events' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "today" -> Today's date at 00:00:00Z
- "beginning of this week" -> Monday of the current week at 00:00:00Z
- "start of month" -> First day of current month at 00:00:00Z
- "last week" -> 7 days ago at 00:00:00Z

Return ONLY the timestamp string in ISO 8601 format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start time (e.g., "today", "start of month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'max_start_time',
      title: 'Max Start Time',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'ISO 8601 format (e.g., 2024-12-31T23:59:59Z)',
      condition: { field: 'operation', value: 'calendly_list_scheduled_events' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "end of today" -> Today's date at 23:59:59Z
- "end of this week" -> Sunday of the current week at 23:59:59Z
- "end of month" -> Last day of current month at 23:59:59Z
- "next week" -> 7 days from now at 23:59:59Z

Return ONLY the timestamp string in ISO 8601 format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end time (e.g., "end of week", "end of month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'status',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Active', id: 'active' },
        { label: 'Canceled', id: 'canceled' },
      ],
      condition: {
        field: 'operation',
        value: ['calendly_list_scheduled_events', 'calendly_list_event_invitees'],
      },
    },
    {
      id: 'startTime',
      title: 'Start Time',
      type: 'short-input',
      placeholder: 'ISO 8601 format (e.g., 2024-01-01T00:00:00Z)',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'calendly_list_event_type_available_times',
          'calendly_list_user_busy_times',
          'calendly_create_event_invitee',
        ],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "today" -> Today's date at 00:00:00Z
- "tomorrow morning" -> Tomorrow's date at 09:00:00Z
- "start of next week" -> Monday of next week at 00:00:00Z

Return ONLY the timestamp string in ISO 8601 format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start time (e.g., "today", "tomorrow morning")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'endTime',
      title: 'End Time',
      type: 'short-input',
      placeholder: 'ISO 8601 format (e.g., 2024-01-07T00:00:00Z)',
      description:
        'Busy times allow a range of up to 7 days. Available times allow a range of up to 31 days.',
      required: true,
      condition: {
        field: 'operation',
        value: ['calendly_list_event_type_available_times', 'calendly_list_user_busy_times'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "end of today" -> Today's date at 23:59:59Z
- "in 7 days" -> 7 days from now at 23:59:59Z
- "end of this week" -> Sunday of the current week at 23:59:59Z

Return ONLY the timestamp string in ISO 8601 format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end time (e.g., "in 7 days", "end of week")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'eventUuid',
      title: 'Event UUID',
      type: 'short-input',
      placeholder: 'Enter scheduled event UUID or URI',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'calendly_get_scheduled_event',
          'calendly_list_event_invitees',
          'calendly_get_event_invitee',
          'calendly_cancel_event',
        ],
      },
    },
    {
      id: 'inviteeUuid',
      title: 'Invitee UUID',
      type: 'short-input',
      placeholder: 'Enter invitee UUID or URI',
      required: true,
      condition: { field: 'operation', value: 'calendly_get_event_invitee' },
    },
    {
      id: 'reason',
      title: 'Cancellation Reason',
      type: 'long-input',
      placeholder: 'Reason for cancellation (optional)',
      condition: { field: 'operation', value: 'calendly_cancel_event' },
    },
    {
      id: 'inviteeEmail',
      title: 'Invitee Email',
      type: 'short-input',
      placeholder: 'Email address of the person being booked',
      required: true,
      condition: { field: 'operation', value: 'calendly_create_event_invitee' },
    },
    {
      id: 'inviteeName',
      title: 'Invitee Name',
      type: 'short-input',
      placeholder: 'Full name of the invitee',
      description: 'Provide a full name or a first name.',
      condition: { field: 'operation', value: 'calendly_create_event_invitee' },
    },
    {
      id: 'inviteeTimezone',
      title: 'Invitee Timezone',
      type: 'short-input',
      placeholder: 'IANA timezone (e.g., America/New_York)',
      required: true,
      condition: { field: 'operation', value: 'calendly_create_event_invitee' },
    },
    {
      id: 'inviteeFirstName',
      title: 'Invitee First Name',
      type: 'short-input',
      placeholder: 'First name of the invitee',
      mode: 'advanced',
      condition: { field: 'operation', value: 'calendly_create_event_invitee' },
    },
    {
      id: 'inviteeLastName',
      title: 'Invitee Last Name',
      type: 'short-input',
      placeholder: 'Last name of the invitee',
      mode: 'advanced',
      condition: { field: 'operation', value: 'calendly_create_event_invitee' },
    },
    {
      id: 'textReminderNumber',
      title: 'Text Reminder Number',
      type: 'short-input',
      placeholder: 'E.164 phone number (e.g., +14155551234)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'calendly_create_event_invitee' },
    },
    {
      id: 'eventGuests',
      title: 'Event Guests',
      type: 'long-input',
      placeholder: '["guest@example.com"]',
      description: 'Additional guests to copy on the invite. Maximum of 10.',
      mode: 'advanced',
      condition: { field: 'operation', value: 'calendly_create_event_invitee' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of guest email address strings, for example ["guest@example.com"]. Return ONLY the JSON array - no explanations, no extra text.',
        placeholder: 'Describe the guests to copy on the invite...',
        generationType: 'json-object',
      },
    },
    {
      id: 'inviteeUri',
      title: 'Invitee URI',
      type: 'short-input',
      placeholder: 'https://api.calendly.com/scheduled_events/.../invitees/...',
      required: true,
      condition: { field: 'operation', value: 'calendly_create_invitee_no_show' },
    },
    {
      id: 'noShowUuid',
      title: 'No-Show UUID',
      type: 'short-input',
      placeholder: 'Enter no-show UUID or URI',
      required: true,
      condition: { field: 'operation', value: 'calendly_delete_invitee_no_show' },
    },
    {
      id: 'role',
      title: 'Role',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Owner', id: 'owner' },
        { label: 'Admin', id: 'admin' },
        { label: 'User', id: 'user' },
      ],
      condition: { field: 'operation', value: 'calendly_list_organization_memberships' },
    },
    {
      id: 'formUri',
      title: 'Routing Form',
      type: 'short-input',
      placeholder: 'Enter routing form UUID or URI',
      required: true,
      condition: { field: 'operation', value: 'calendly_list_routing_form_submissions' },
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Filter by invitee email',
      condition: {
        field: 'operation',
        value: ['calendly_list_event_invitees', 'calendly_list_organization_memberships'],
      },
    },
    {
      id: 'count',
      title: 'Results Per Page',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Number of results (default: 20, max: 100)',
      condition: {
        field: 'operation',
        value: [
          'calendly_list_event_types',
          'calendly_list_scheduled_events',
          'calendly_list_event_invitees',
          'calendly_list_organization_memberships',
          'calendly_list_routing_forms',
          'calendly_list_routing_form_submissions',
        ],
      },
    },
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Token for pagination',
      condition: {
        field: 'operation',
        value: [
          'calendly_list_event_types',
          'calendly_list_scheduled_events',
          'calendly_list_event_invitees',
          'calendly_list_organization_memberships',
          'calendly_list_routing_forms',
          'calendly_list_routing_form_submissions',
        ],
      },
    },
    {
      id: 'sort',
      title: 'Sort Order',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g., "name:asc", "start_time:desc"',
      condition: {
        field: 'operation',
        value: [
          'calendly_list_event_types',
          'calendly_list_scheduled_events',
          'calendly_list_event_invitees',
          'calendly_list_routing_forms',
          'calendly_list_routing_form_submissions',
        ],
      },
    },
    ...getTrigger('calendly_invitee_created').subBlocks,
    ...getTrigger('calendly_invitee_canceled').subBlocks,
    ...getTrigger('calendly_routing_form_submitted').subBlocks,
    ...getTrigger('calendly_webhook').subBlocks,
  ],
  tools: {
    access: [
      'calendly_get_current_user',
      'calendly_get_user',
      'calendly_list_event_types',
      'calendly_get_event_type',
      'calendly_list_event_type_available_times',
      'calendly_list_scheduled_events',
      'calendly_get_scheduled_event',
      'calendly_list_event_invitees',
      'calendly_get_event_invitee',
      'calendly_create_event_invitee',
      'calendly_cancel_event',
      'calendly_create_invitee_no_show',
      'calendly_delete_invitee_no_show',
      'calendly_create_scheduling_link',
      'calendly_list_user_busy_times',
      'calendly_list_user_availability_schedules',
      'calendly_list_organization_memberships',
      'calendly_list_routing_forms',
      'calendly_list_routing_form_submissions',
    ],
    config: {
      tool: (params) => {
        return params.operation || 'calendly_list_scheduled_events'
      },
      params: (params) => {
        const { operation, events, eventGuests, active, ...rest } = params

        return {
          ...rest,
          // The switch cannot express "inactive only", so off means unfiltered, not `active=false`.
          ...(active === true && { active: true }),
          ...(events !== undefined && { events: parseJsonArray(events, 'events') }),
          ...(eventGuests !== undefined && {
            eventGuests: parseJsonArray(eventGuests, 'eventGuests'),
          }),
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Personal access token' },
    userUuid: { type: 'string', description: 'User UUID' },
    eventTypeUuid: { type: 'string', description: 'Event type UUID' },
    eventTypeUri: { type: 'string', description: 'Event type UUID or URI' },
    user: { type: 'string', description: 'User URI filter' },
    organization: { type: 'string', description: 'Organization URI' },
    active: { type: 'boolean', description: 'Filter by active status' },
    startTime: { type: 'string', description: 'Start of the requested range (ISO 8601)' },
    endTime: { type: 'string', description: 'End of the requested range (ISO 8601)' },
    eventUuid: { type: 'string', description: 'Scheduled event UUID' },
    invitee_email: { type: 'string', description: 'Filter by invitee email' },
    min_start_time: { type: 'string', description: 'Minimum start time (ISO 8601)' },
    max_start_time: { type: 'string', description: 'Maximum start time (ISO 8601)' },
    status: { type: 'string', description: 'Status filter (active or canceled)' },
    reason: { type: 'string', description: 'Cancellation reason' },
    email: { type: 'string', description: 'Filter by email' },
    inviteeUuid: { type: 'string', description: 'Invitee UUID' },
    inviteeUri: { type: 'string', description: 'Invitee URI' },
    noShowUuid: { type: 'string', description: 'No-show UUID' },
    inviteeEmail: { type: 'string', description: 'Email address of the invitee being booked' },
    inviteeName: { type: 'string', description: 'Full name of the invitee' },
    inviteeFirstName: { type: 'string', description: 'First name of the invitee' },
    inviteeLastName: { type: 'string', description: 'Last name of the invitee' },
    inviteeTimezone: { type: 'string', description: 'Timezone of the invitee' },
    textReminderNumber: { type: 'string', description: 'Phone number for SMS reminders' },
    eventGuests: { type: 'json', description: 'Array of additional guest email addresses' },
    role: { type: 'string', description: 'Filter memberships by role' },
    formUri: { type: 'string', description: 'Routing form UUID or URI' },
    count: { type: 'number', description: 'Results per page' },
    pageToken: { type: 'string', description: 'Pagination token' },
    sort: { type: 'string', description: 'Sort order' },
    webhookUuid: { type: 'string', description: 'Webhook UUID' },
    url: { type: 'string', description: 'Webhook callback URL' },
    events: { type: 'json', description: 'Array of event types' },
    scope: { type: 'string', description: 'Webhook scope' },
    signing_key: { type: 'string', description: 'Webhook signing key' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether operation succeeded' },
    resource: { type: 'json', description: 'Resource data (user, event type, event, etc.)' },
    collection: { type: 'json', description: 'Array of items' },
    pagination: { type: 'json', description: 'Pagination information' },
    uri: { type: 'string', description: 'Resource URI' },
    name: { type: 'string', description: 'Resource name' },
    email: { type: 'string', description: 'Email address' },
    status: { type: 'string', description: 'Status' },
    start_time: { type: 'string', description: 'Event start time (ISO 8601)' },
    end_time: { type: 'string', description: 'Event end time (ISO 8601)' },
    location: { type: 'json', description: 'Event location details' },
    scheduling_url: { type: 'string', description: 'Scheduling page URL' },
    booking_url: { type: 'string', description: 'Single-use scheduling link' },
    callback_url: { type: 'string', description: 'Webhook URL' },
    signing_key: { type: 'string', description: 'Webhook signing key' },
    deleted: { type: 'boolean', description: 'Whether deletion succeeded' },
    message: { type: 'string', description: 'Status message' },
    event: { type: 'string', description: 'Webhook event type' },
    created_at: { type: 'string', description: 'Webhook event creation timestamp' },
    created_by: {
      type: 'string',
      description: 'URI of the Calendly user who created this webhook',
    },
    payload: { type: 'json', description: 'Complete webhook payload data' },
  },
  triggers: {
    enabled: true,
    available: [
      'calendly_invitee_created',
      'calendly_invitee_canceled',
      'calendly_routing_form_submitted',
      'calendly_webhook',
    ],
  },
}

export const CalendlyBlockMeta = {
  tags: ['scheduling', 'calendar', 'meeting'],
  url: 'https://calendly.com',
  templates: [
    {
      icon: CalendlyIcon,
      title: 'Calendly booking follow-up',
      prompt:
        'Build a workflow that monitors new Calendly bookings, researches each attendee and their company, prepares a pre-meeting brief with relevant context, and sends a personalized confirmation email with an agenda and any prep materials.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['sales', 'research', 'automation'],
    },
    {
      icon: CalendlyIcon,
      title: 'Calendly meeting-prep brief',
      prompt:
        'Build a workflow that runs 30 minutes before a Calendly booking, researches the attendee and company with Apollo, and emails the host a structured prep brief.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['apollo', 'gmail'],
    },
    {
      icon: CalendlyIcon,
      title: 'Calendly post-meeting recap',
      prompt:
        'Create a workflow that runs after a Calendly meeting ends, pulls the meeting notes from the calendar, writes a CRM-ready summary, and updates the linked Salesforce opportunity.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: CalendlyIcon,
      title: 'Calendly no-show recovery',
      prompt:
        'Build a workflow that detects Calendly no-shows, sends a polite reschedule email with a one-tap link, and updates the deal record with the no-show event.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: CalendlyIcon,
      title: 'Calendly + Loops nurture',
      prompt:
        'Create a workflow that on a Calendly booking enrolls the attendee into a Loops nurture campaign tailored to the meeting topic, ensuring follow-up emails reach them before the meeting.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'communication'],
      alsoIntegrations: ['loops'],
    },
    {
      icon: CalendlyIcon,
      title: 'Calendly no-show tracker',
      prompt:
        "Build a scheduled workflow that lists yesterday's Calendly scheduled events, checks invitee status to find no-shows, logs them to a table for follow-up, and posts a recap of attended versus missed meetings to Slack.",
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'reporting', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CalendlyIcon,
      title: 'Calendly booking prep brief',
      prompt:
        'Create a workflow that on a new Calendly booking fetches the scheduled event and invitee details, researches the attendee and their company, and emails the meeting owner a one-page prep brief before the call.',
      modules: ['agent', 'files', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'automation'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'book-a-meeting',
      description:
        'Find an open slot on a Calendly event type and book an invitee into it. Use to schedule a meeting end to end without sending the invitee a link.',
      content:
        '# Book a Meeting\n\nSchedule a Calendly meeting directly.\n\n## Steps\n1. Use List Event Types to find the event type to book, and take its URI.\n2. Use List Event Type Available Times with that event type and a start/end window (ISO 8601 UTC, at most 31 days apart) to get open slots.\n3. Pick a slot and use Book Meeting with the event type, the slot start time, and the invitee email, timezone, and name. Add event guests to copy others on the invite.\n\n## Output\nReturn the booked start time, the invitee, and the reschedule and cancel URLs. Booking requires a paid Calendly plan; if the call is rejected as forbidden, say so rather than retrying. If no slot matches the request, report the nearest available times instead of booking a different one.',
    },
    {
      name: 'check-availability',
      description:
        "Read a Calendly user's busy times and working hours for a date range. Use to find when someone is free before proposing times.",
      content:
        "# Check Availability\n\nInspect when a host is free.\n\n## Steps\n1. Get the user URI (Get Current User for yourself, or List Organization Memberships to find a teammate by email).\n2. Use List User Busy Times with that user and a start/end window (ISO 8601 UTC, at most 7 days apart) to get booked and externally blocked time.\n3. Use List User Availability Schedules to read the working hours and date overrides the busy times sit inside.\n\n## Output\nReturn the free windows implied by the working hours minus the busy blocks, in the schedule's timezone. Note which busy blocks are Calendly events versus external calendar holds. Both endpoints cap the range, so split a longer request into several calls rather than widening the window.",
    },
    {
      name: 'share-a-single-use-link',
      description:
        'Create a one-time Calendly booking link for an event type. Use to invite someone to schedule without exposing a reusable link.',
      content:
        '# Share a Single-Use Link\n\nHand out a booking link that works once.\n\n## Steps\n1. Use List Event Types to find the event type and take its URI.\n2. Use Create Scheduling Link with that event type.\n3. Send the returned booking URL to the invitee.\n\n## Output\nReturn the booking URL and the event type it books. Make clear the link expires after one booking, so generate a new one per invitee rather than reusing it.',
    },
    {
      name: 'mark-a-no-show',
      description:
        'Flag a Calendly invitee who did not attend, or clear that flag. Use when reconciling attendance after a meeting.',
      content:
        '# Mark a No-Show\n\nRecord attendance for a past meeting.\n\n## Steps\n1. Use List Event Invitees for the scheduled event and take the URI of the invitee who did not attend.\n2. Use Mark Invitee No-Show with that invitee URI.\n3. To reverse it, take the no-show URI from the invitee record and use Unmark Invitee No-Show.\n\n## Output\nReturn which invitees were marked and the no-show URI for each, so the flag can be reversed later. Only mark meetings that have already ended.',
    },
    {
      name: 'list-upcoming-meetings',
      description:
        'Pull upcoming Calendly scheduled events for a date range and summarize them. Use to brief a host on their schedule or build a daily agenda.',
      content:
        '# List Upcoming Meetings\n\nSummarize upcoming Calendly events.\n\n## Steps\n1. Use List Scheduled Events. Filter to status active and set Min Start Time and Max Start Time (ISO 8601 UTC) for the window.\n2. Filter by user or organization URI when scoping to a specific host (Get Current User returns your URI if needed).\n3. For each event, read name, start_time, end_time, location, and scheduling_url; page with the page token if there are many.\n\n## Output\nReturn an ordered agenda: each meeting with time, name, location/join link, and the invitee. Add a one-line headline (count and first start time) for a quick read.',
    },
    {
      name: 'get-event-attendees',
      description:
        'Retrieve the invitees for a Calendly scheduled event, including answers and contact info. Use to prep for a meeting or sync attendees to a CRM.',
      content:
        '# Get Event Attendees\n\nList who is attending a Calendly event.\n\n## Steps\n1. Identify the scheduled event by its UUID or URI (use List Scheduled Events to locate it).\n2. Use List Event Invitees for that event; optionally filter by email or status.\n3. Read each invitee record: name, email, status, and any questions and answers captured at booking.\n\n## Output\nReturn the invitees with name, email, status, and their intake answers. Flag canceled or no-show invitees so they can be handled differently from confirmed attendees.',
    },
    {
      name: 'cancel-scheduled-event',
      description:
        'Cancel a Calendly scheduled event with an optional reason. Use to call off a meeting and notify the invitee through Calendly.',
      content:
        '# Cancel Scheduled Event\n\nCall off a Calendly meeting.\n\n## Steps\n1. Find the scheduled event UUID or URI (use List Scheduled Events filtered by invitee email or time if you only have those details).\n2. Use Cancel Event with the event UUID and a clear cancellation reason.\n3. Calendly notifies the invitee automatically.\n\n## Output\nReturn the event UUID and confirmation that it was canceled. Echo the reason. If the event is already canceled or cannot be found, report that instead of retrying.',
    },
  ],
} as const satisfies BlockMeta
