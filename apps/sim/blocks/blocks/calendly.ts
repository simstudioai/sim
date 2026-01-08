import { CalendlyIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { ToolResponse } from '@/tools/types'
import { getTrigger } from '@/triggers'

export const CalendlyBlock: BlockConfig<ToolResponse> = {
  type: 'calendly',
  name: 'Calendly',
  description: 'Manage Calendly scheduling and events',
  authMode: AuthMode.ApiKey,
  triggerAllowed: true,
  longDescription:
    'Integrate Calendly into your workflow. Manage event types, scheduled events, invitees, and webhooks. Can also trigger workflows based on Calendly webhook events (invitee scheduled, invitee canceled, routing form submitted). Requires Personal Access Token.',
  docsLink: 'https://docs.sim.ai/tools/calendly',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: CalendlyIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Current User', id: 'calendly_get_current_user' },
        { label: 'List Event Types', id: 'calendly_list_event_types' },
        { label: 'Get Event Type', id: 'calendly_get_event_type' },
        { label: 'List Scheduled Events', id: 'calendly_list_scheduled_events' },
        { label: 'Get Scheduled Event', id: 'calendly_get_scheduled_event' },
        { label: 'List Event Invitees', id: 'calendly_list_event_invitees' },
        { label: 'Cancel Event', id: 'calendly_cancel_event' },
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
    // Get Event Type fields
    {
      id: 'eventTypeUuid',
      title: 'Event Type UUID',
      type: 'short-input',
      placeholder: 'Enter event type UUID or URI',
      required: true,
      condition: { field: 'operation', value: 'calendly_get_event_type' },
    },
    // List Event Types fields
    {
      id: 'user',
      title: 'User URI',
      type: 'short-input',
      placeholder: 'Filter by user URI',
      condition: {
        field: 'operation',
        value: ['calendly_list_event_types', 'calendly_list_scheduled_events'],
      },
    },
    {
      id: 'organization',
      title: 'Organization URI',
      type: 'short-input',
      placeholder: 'Filter by organization URI (optional)',
      condition: {
        field: 'operation',
        value: ['calendly_list_event_types', 'calendly_list_scheduled_events'],
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
    // List Scheduled Events fields
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
    // Get Scheduled Event / List Invitees / Cancel Event fields
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
          'calendly_cancel_event',
        ],
      },
    },
    // Cancel Event fields
    {
      id: 'reason',
      title: 'Cancellation Reason',
      type: 'long-input',
      placeholder: 'Reason for cancellation (optional)',
      condition: { field: 'operation', value: 'calendly_cancel_event' },
    },
    // List Event Invitees fields
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Filter by invitee email',
      condition: { field: 'operation', value: 'calendly_list_event_invitees' },
    },
    // Pagination fields
    {
      id: 'count',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: 'Number of results (default: 20, max: 100)',
      condition: {
        field: 'operation',
        value: [
          'calendly_list_event_types',
          'calendly_list_scheduled_events',
          'calendly_list_event_invitees',
        ],
      },
    },
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: 'Token for pagination',
      condition: {
        field: 'operation',
        value: [
          'calendly_list_event_types',
          'calendly_list_scheduled_events',
          'calendly_list_event_invitees',
        ],
      },
    },
    {
      id: 'sort',
      title: 'Sort Order',
      type: 'short-input',
      placeholder: 'e.g., "name:asc", "start_time:desc"',
      condition: {
        field: 'operation',
        value: [
          'calendly_list_event_types',
          'calendly_list_scheduled_events',
          'calendly_list_event_invitees',
        ],
      },
    },
    // Trigger SubBlocks
    ...getTrigger('calendly_invitee_created').subBlocks,
    ...getTrigger('calendly_invitee_canceled').subBlocks,
    ...getTrigger('calendly_routing_form_submitted').subBlocks,
    ...getTrigger('calendly_webhook').subBlocks,
  ],
  tools: {
    access: [
      'calendly_get_current_user',
      'calendly_list_event_types',
      'calendly_get_event_type',
      'calendly_list_scheduled_events',
      'calendly_get_scheduled_event',
      'calendly_list_event_invitees',
      'calendly_cancel_event',
    ],
    config: {
      tool: (params) => {
        return params.operation || 'calendly_list_scheduled_events'
      },
      params: (params) => {
        const { operation, events, ...rest } = params

        let parsedEvents: any | undefined

        try {
          if (events) parsedEvents = JSON.parse(events)
        } catch (error: any) {
          throw new Error(`Invalid JSON input for events: ${error.message}`)
        }

        return {
          ...rest,
          ...(parsedEvents && { events: parsedEvents }),
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Personal access token' },
    // Event Type params
    eventTypeUuid: { type: 'string', description: 'Event type UUID' },
    user: { type: 'string', description: 'User URI filter' },
    organization: { type: 'string', description: 'Organization URI' },
    active: { type: 'boolean', description: 'Filter by active status' },
    // Scheduled Event params
    eventUuid: { type: 'string', description: 'Scheduled event UUID' },
    invitee_email: { type: 'string', description: 'Filter by invitee email' },
    min_start_time: { type: 'string', description: 'Minimum start time (ISO 8601)' },
    max_start_time: { type: 'string', description: 'Maximum start time (ISO 8601)' },
    status: { type: 'string', description: 'Status filter (active or canceled)' },
    // Cancel Event params
    reason: { type: 'string', description: 'Cancellation reason' },
    // Invitees params
    email: { type: 'string', description: 'Filter by email' },
    // Pagination params
    count: { type: 'number', description: 'Results per page' },
    pageToken: { type: 'string', description: 'Pagination token' },
    sort: { type: 'string', description: 'Sort order' },
    // Webhook params
    webhookUuid: { type: 'string', description: 'Webhook UUID' },
    url: { type: 'string', description: 'Webhook callback URL' },
    events: { type: 'json', description: 'Array of event types' },
    scope: { type: 'string', description: 'Webhook scope' },
    signing_key: { type: 'string', description: 'Webhook signing key' },
  },
  outputs: {
    // Common outputs
    success: { type: 'boolean', description: 'Whether operation succeeded' },
    // User outputs
    resource: { type: 'json', description: 'Resource data (user, event type, event, etc.)' },
    // List outputs
    collection: { type: 'json', description: 'Array of items' },
    pagination: { type: 'json', description: 'Pagination information' },
    // Event details
    uri: { type: 'string', description: 'Resource URI' },
    name: { type: 'string', description: 'Resource name' },
    email: { type: 'string', description: 'Email address' },
    status: { type: 'string', description: 'Status' },
    start_time: { type: 'string', description: 'Event start time (ISO 8601)' },
    end_time: { type: 'string', description: 'Event end time (ISO 8601)' },
    location: { type: 'json', description: 'Event location details' },
    scheduling_url: { type: 'string', description: 'Scheduling page URL' },
    // Webhook outputs
    callback_url: { type: 'string', description: 'Webhook URL' },
    signing_key: { type: 'string', description: 'Webhook signing key' },
    // Delete outputs
    deleted: { type: 'boolean', description: 'Whether deletion succeeded' },
    message: { type: 'string', description: 'Status message' },
    // Trigger outputs
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
