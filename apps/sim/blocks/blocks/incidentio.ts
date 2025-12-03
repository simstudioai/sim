import { IncidentioIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { IncidentioResponse } from '@/tools/incidentio/types'

export const IncidentioBlock: BlockConfig<IncidentioResponse> = {
  type: 'incidentio',
  name: 'incidentio',
  description: 'Manage incidents with incident.io',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate incident.io into the workflow. Manage incidents, actions, follow-ups, workflows, schedules, escalations, custom fields, and more.',
  docsLink: 'https://docs.sim.ai/tools/incidentio',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: IncidentioIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Incidents
        { label: 'List Incidents', id: 'incidentio_incidents_list' },
        { label: 'Create Incident', id: 'incidentio_incidents_create' },
        { label: 'Show Incident', id: 'incidentio_incidents_show' },
        { label: 'Update Incident', id: 'incidentio_incidents_update' },
        // Actions
        { label: 'List Actions', id: 'incidentio_actions_list' },
        { label: 'Show Action', id: 'incidentio_actions_show' },
        // Follow-ups
        { label: 'List Follow-ups', id: 'incidentio_follow_ups_list' },
        { label: 'Show Follow-up', id: 'incidentio_follow_ups_show' },
        // Users
        { label: 'List Users', id: 'incidentio_users_list' },
        { label: 'Show User', id: 'incidentio_users_show' },
        // Workflows
        { label: 'List Workflows', id: 'incidentio_workflows_list' },
        { label: 'Show Workflow', id: 'incidentio_workflows_show' },
        { label: 'Update Workflow', id: 'incidentio_workflows_update' },
        { label: 'Delete Workflow', id: 'incidentio_workflows_delete' },
        // Schedules
        { label: 'List Schedules', id: 'incidentio_schedules_list' },
        { label: 'Create Schedule', id: 'incidentio_schedules_create' },
        { label: 'Show Schedule', id: 'incidentio_schedules_show' },
        { label: 'Update Schedule', id: 'incidentio_schedules_update' },
        { label: 'Delete Schedule', id: 'incidentio_schedules_delete' },
        // Escalations
        { label: 'List Escalations', id: 'incidentio_escalations_list' },
        { label: 'Create Escalation', id: 'incidentio_escalations_create' },
        { label: 'Show Escalation', id: 'incidentio_escalations_show' },
        // Custom Fields
        { label: 'List Custom Fields', id: 'incidentio_custom_fields_list' },
        { label: 'Create Custom Field', id: 'incidentio_custom_fields_create' },
        { label: 'Show Custom Field', id: 'incidentio_custom_fields_show' },
        { label: 'Update Custom Field', id: 'incidentio_custom_fields_update' },
        { label: 'Delete Custom Field', id: 'incidentio_custom_fields_delete' },
        // Reference Data
        { label: 'List Severities', id: 'incidentio_severities_list' },
        { label: 'List Incident Statuses', id: 'incidentio_incident_statuses_list' },
        { label: 'List Incident Types', id: 'incidentio_incident_types_list' },
        // Incident Roles
        { label: 'List Incident Roles', id: 'incidentio_incident_roles_list' },
        { label: 'Create Incident Role', id: 'incidentio_incident_roles_create' },
        { label: 'Show Incident Role', id: 'incidentio_incident_roles_show' },
        { label: 'Update Incident Role', id: 'incidentio_incident_roles_update' },
        { label: 'Delete Incident Role', id: 'incidentio_incident_roles_delete' },
        // Incident Timestamps
        { label: 'List Incident Timestamps', id: 'incidentio_incident_timestamps_list' },
        { label: 'Show Incident Timestamp', id: 'incidentio_incident_timestamps_show' },
        // Incident Updates
        { label: 'List Incident Updates', id: 'incidentio_incident_updates_list' },
        // Schedule Entries
        { label: 'List Schedule Entries', id: 'incidentio_schedule_entries_list' },
        // Schedule Overrides
        { label: 'Create Schedule Override', id: 'incidentio_schedule_overrides_create' },
        // Escalation Paths
        { label: 'Create Escalation Path', id: 'incidentio_escalation_paths_create' },
        { label: 'Show Escalation Path', id: 'incidentio_escalation_paths_show' },
        { label: 'Update Escalation Path', id: 'incidentio_escalation_paths_update' },
        { label: 'Delete Escalation Path', id: 'incidentio_escalation_paths_delete' },
      ],
      value: () => 'incidentio_incidents_list',
    },
    // Common pagination field
    {
      id: 'page_size',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '25',
      condition: {
        field: 'operation',
        value: [
          'incidentio_incidents_list',
          'incidentio_actions_list',
          'incidentio_follow_ups_list',
          'incidentio_users_list',
          'incidentio_workflows_list',
          'incidentio_schedules_list',
          'incidentio_escalations_list',
          'incidentio_incident_updates_list',
          'incidentio_schedule_entries_list',
        ],
      },
    },
    // Pagination 'after' field for list operations
    {
      id: 'after',
      title: 'After (Pagination)',
      type: 'short-input',
      placeholder: 'Cursor for pagination',
      condition: {
        field: 'operation',
        value: [
          'incidentio_incidents_list',
          'incidentio_workflows_list',
          'incidentio_schedules_list',
          'incidentio_incident_updates_list',
          'incidentio_schedule_entries_list',
        ],
      },
    },
    // Incidents Create operation inputs
    {
      id: 'name',
      title: 'Incident Name',
      type: 'short-input',
      placeholder: 'Enter incident name...',
      condition: { field: 'operation', value: 'incidentio_incidents_create' },
    },
    {
      id: 'summary',
      title: 'Summary',
      type: 'long-input',
      placeholder: 'Enter incident summary...',
      condition: {
        field: 'operation',
        value: ['incidentio_incidents_create', 'incidentio_incidents_update'],
      },
    },
    {
      id: 'severity_id',
      title: 'Severity ID',
      type: 'short-input',
      placeholder: 'Enter severity ID...',
      condition: { field: 'operation', value: 'incidentio_incidents_create' },
      required: true,
    },
    {
      id: 'severity_id',
      title: 'Severity ID',
      type: 'short-input',
      placeholder: 'Enter severity ID...',
      condition: { field: 'operation', value: 'incidentio_incidents_update' },
    },
    {
      id: 'incident_type_id',
      title: 'Incident Type ID',
      type: 'short-input',
      placeholder: 'Enter incident type ID...',
      condition: {
        field: 'operation',
        value: ['incidentio_incidents_create', 'incidentio_incidents_update'],
      },
    },
    {
      id: 'incident_status_id',
      title: 'Incident Status ID',
      type: 'short-input',
      placeholder: 'Enter incident status ID...',
      condition: {
        field: 'operation',
        value: ['incidentio_incidents_create', 'incidentio_incidents_update'],
      },
    },
    {
      id: 'notify_incident_channel',
      title: 'Notify Incident Channel',
      type: 'switch',
      value: () => 'true',
      condition: { field: 'operation', value: 'incidentio_incidents_update' },
      required: true,
    },
    {
      id: 'visibility',
      title: 'Visibility',
      type: 'dropdown',
      options: [
        { label: 'Public', id: 'public' },
        { label: 'Private', id: 'private' },
      ],
      value: () => 'public',
      condition: { field: 'operation', value: 'incidentio_incidents_create' },
      required: true,
    },
    {
      id: 'idempotency_key',
      title: 'Idempotency Key',
      type: 'short-input',
      placeholder: 'Enter unique key (e.g., UUID)',
      condition: { field: 'operation', value: 'incidentio_incidents_create' },
      required: true,
    },
    // Show/Update Incident inputs
    {
      id: 'id',
      title: 'ID',
      type: 'short-input',
      placeholder: 'Enter ID...',
      condition: {
        field: 'operation',
        value: [
          'incidentio_incidents_show',
          'incidentio_incidents_update',
          'incidentio_actions_show',
          'incidentio_follow_ups_show',
          'incidentio_users_show',
          'incidentio_workflows_show',
          'incidentio_workflows_update',
          'incidentio_workflows_delete',
          'incidentio_schedules_show',
          'incidentio_schedules_update',
          'incidentio_schedules_delete',
          'incidentio_escalations_show',
          'incidentio_custom_fields_show',
          'incidentio_custom_fields_update',
          'incidentio_custom_fields_delete',
          'incidentio_incident_roles_show',
          'incidentio_incident_roles_update',
          'incidentio_incident_roles_delete',
          'incidentio_incident_timestamps_show',
          'incidentio_escalation_paths_show',
          'incidentio_escalation_paths_update',
          'incidentio_escalation_paths_delete',
        ],
      },
      required: true,
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Enter name...',
      condition: {
        field: 'operation',
        value: [
          'incidentio_schedules_create',
          'incidentio_custom_fields_create',
          'incidentio_custom_fields_update',
          'incidentio_incident_roles_create',
          'incidentio_incident_roles_update',
          'incidentio_escalation_paths_create',
        ],
      },
      required: true,
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Enter name (optional for update)...',
      condition: {
        field: 'operation',
        value: 'incidentio_escalation_paths_update',
      },
      required: false,
    },
    // Escalations inputs
    {
      id: 'idempotency_key',
      title: 'Idempotency Key',
      type: 'short-input',
      placeholder: 'Enter unique key (e.g., UUID)...',
      condition: { field: 'operation', value: 'incidentio_escalations_create' },
      required: true,
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Enter escalation title...',
      condition: { field: 'operation', value: 'incidentio_escalations_create' },
      required: true,
    },
    {
      id: 'escalation_path_id',
      title: 'Escalation Path ID',
      type: 'short-input',
      placeholder: 'Enter escalation path ID (required if no user IDs)...',
      condition: { field: 'operation', value: 'incidentio_escalations_create' },
    },
    {
      id: 'user_ids',
      title: 'User IDs',
      type: 'short-input',
      placeholder: 'Enter user IDs, comma-separated (required if no path ID)...',
      condition: { field: 'operation', value: 'incidentio_escalations_create' },
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Enter name...',
      condition: {
        field: 'operation',
        value: [
          'incidentio_incidents_update',
          'incidentio_workflows_update',
          'incidentio_schedules_update',
        ],
      },
    },
    // Actions List inputs
    {
      id: 'incident_id',
      title: 'Incident ID',
      type: 'short-input',
      placeholder: 'Filter by incident ID...',
      condition: {
        field: 'operation',
        value: ['incidentio_actions_list', 'incidentio_follow_ups_list'],
      },
    },
    // Workflows inputs
    {
      id: 'folder',
      title: 'Folder',
      type: 'short-input',
      placeholder: 'Enter folder name...',
      condition: { field: 'operation', value: 'incidentio_workflows_update' },
    },
    {
      id: 'state',
      title: 'State',
      type: 'dropdown',
      options: [
        { label: 'Active', id: 'active' },
        { label: 'Draft', id: 'draft' },
        { label: 'Disabled', id: 'disabled' },
      ],
      value: () => 'active',
      condition: { field: 'operation', value: 'incidentio_workflows_update' },
    },
    // Schedules inputs
    {
      id: 'timezone',
      title: 'Timezone',
      type: 'dropdown',
      options: [
        { label: 'America/New_York (Eastern)', id: 'America/New_York' },
        { label: 'America/Chicago (Central)', id: 'America/Chicago' },
        { label: 'America/Denver (Mountain)', id: 'America/Denver' },
        { label: 'America/Los_Angeles (Pacific)', id: 'America/Los_Angeles' },
        { label: 'America/Phoenix (Arizona)', id: 'America/Phoenix' },
        { label: 'America/Anchorage (Alaska)', id: 'America/Anchorage' },
        { label: 'Pacific/Honolulu (Hawaii)', id: 'Pacific/Honolulu' },
        { label: 'Europe/London (UK)', id: 'Europe/London' },
        { label: 'Europe/Paris (Central Europe)', id: 'Europe/Paris' },
        { label: 'Europe/Berlin (Germany)', id: 'Europe/Berlin' },
        { label: 'Europe/Dublin (Ireland)', id: 'Europe/Dublin' },
        { label: 'Europe/Amsterdam (Netherlands)', id: 'Europe/Amsterdam' },
        { label: 'Asia/Tokyo (Japan)', id: 'Asia/Tokyo' },
        { label: 'Asia/Singapore', id: 'Asia/Singapore' },
        { label: 'Asia/Hong_Kong', id: 'Asia/Hong_Kong' },
        { label: 'Asia/Shanghai (China)', id: 'Asia/Shanghai' },
        { label: 'Asia/Seoul (South Korea)', id: 'Asia/Seoul' },
        { label: 'Asia/Dubai (UAE)', id: 'Asia/Dubai' },
        { label: 'Asia/Kolkata (India)', id: 'Asia/Kolkata' },
        { label: 'Australia/Sydney', id: 'Australia/Sydney' },
        { label: 'Australia/Melbourne', id: 'Australia/Melbourne' },
        { label: 'Pacific/Auckland (New Zealand)', id: 'Pacific/Auckland' },
        { label: 'UTC', id: 'UTC' },
      ],
      value: () => 'UTC',
      condition: { field: 'operation', value: 'incidentio_schedules_create' },
      required: true,
    },
    {
      id: 'config',
      title: 'Schedule Configuration',
      type: 'long-input',
      placeholder:
        'JSON configuration with rotations. Example: {"rotations": [{"name": "Primary", "users": [{"id": "user_id"}], "handover_start_at": "2024-01-01T09:00:00Z", "handovers": [{"interval": 1, "interval_type": "weekly"}]}]}',
      condition: { field: 'operation', value: 'incidentio_schedules_create' },
      required: true,
    },
    {
      id: 'timezone',
      title: 'Timezone',
      type: 'dropdown',
      options: [
        { label: 'America/New_York (Eastern)', id: 'America/New_York' },
        { label: 'America/Chicago (Central)', id: 'America/Chicago' },
        { label: 'America/Denver (Mountain)', id: 'America/Denver' },
        { label: 'America/Los_Angeles (Pacific)', id: 'America/Los_Angeles' },
        { label: 'America/Phoenix (Arizona)', id: 'America/Phoenix' },
        { label: 'America/Anchorage (Alaska)', id: 'America/Anchorage' },
        { label: 'Pacific/Honolulu (Hawaii)', id: 'Pacific/Honolulu' },
        { label: 'Europe/London (UK)', id: 'Europe/London' },
        { label: 'Europe/Paris (Central Europe)', id: 'Europe/Paris' },
        { label: 'Europe/Berlin (Germany)', id: 'Europe/Berlin' },
        { label: 'Europe/Dublin (Ireland)', id: 'Europe/Dublin' },
        { label: 'Europe/Amsterdam (Netherlands)', id: 'Europe/Amsterdam' },
        { label: 'Asia/Tokyo (Japan)', id: 'Asia/Tokyo' },
        { label: 'Asia/Singapore', id: 'Asia/Singapore' },
        { label: 'Asia/Hong_Kong', id: 'Asia/Hong_Kong' },
        { label: 'Asia/Shanghai (China)', id: 'Asia/Shanghai' },
        { label: 'Asia/Seoul (South Korea)', id: 'Asia/Seoul' },
        { label: 'Asia/Dubai (UAE)', id: 'Asia/Dubai' },
        { label: 'Asia/Kolkata (India)', id: 'Asia/Kolkata' },
        { label: 'Australia/Sydney', id: 'Australia/Sydney' },
        { label: 'Australia/Melbourne', id: 'Australia/Melbourne' },
        { label: 'Pacific/Auckland (New Zealand)', id: 'Pacific/Auckland' },
        { label: 'UTC', id: 'UTC' },
      ],
      value: () => 'UTC',
      condition: { field: 'operation', value: 'incidentio_schedules_update' },
    },
    // Custom Fields inputs
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Enter description...',
      condition: {
        field: 'operation',
        value: ['incidentio_custom_fields_create', 'incidentio_custom_fields_update'],
      },
      required: true,
    },
    {
      id: 'field_type',
      title: 'Field Type',
      type: 'dropdown',
      options: [
        { label: 'Text', id: 'text' },
        { label: 'Single Select', id: 'single_select' },
        { label: 'Multi Select', id: 'multi_select' },
        { label: 'Numeric', id: 'numeric' },
        { label: 'Link', id: 'link' },
      ],
      value: () => 'text',
      condition: { field: 'operation', value: 'incidentio_custom_fields_create' },
      required: true,
    },
    // Incident Roles inputs
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Enter description...',
      condition: {
        field: 'operation',
        value: ['incidentio_incident_roles_create', 'incidentio_incident_roles_update'],
      },
      required: true,
    },
    {
      id: 'instructions',
      title: 'Instructions',
      type: 'long-input',
      placeholder: 'Enter instructions for the role...',
      condition: {
        field: 'operation',
        value: ['incidentio_incident_roles_create', 'incidentio_incident_roles_update'],
      },
      required: true,
    },
    {
      id: 'shortform',
      title: 'Shortform',
      type: 'short-input',
      placeholder: 'Enter short form abbreviation (e.g., INC, LEAD)...',
      condition: {
        field: 'operation',
        value: ['incidentio_incident_roles_create', 'incidentio_incident_roles_update'],
      },
      required: true,
    },
    // Incident Updates inputs
    {
      id: 'incident_id',
      title: 'Incident ID',
      type: 'short-input',
      placeholder: 'Enter incident ID (optional - leave blank for all incidents)...',
      condition: { field: 'operation', value: 'incidentio_incident_updates_list' },
      required: false,
    },
    // Schedule Entries inputs
    {
      id: 'schedule_id',
      title: 'Schedule ID',
      type: 'short-input',
      placeholder: 'Enter schedule ID...',
      condition: {
        field: 'operation',
        value: ['incidentio_schedule_entries_list', 'incidentio_schedule_overrides_create'],
      },
      required: true,
    },
    {
      id: 'entry_window_start',
      title: 'Entry Window Start (Date/Time)',
      type: 'short-input',
      placeholder: 'ISO 8601 format (e.g., 2024-01-01T00:00:00Z)...',
      condition: { field: 'operation', value: 'incidentio_schedule_entries_list' },
    },
    {
      id: 'entry_window_end',
      title: 'Entry Window End (Date/Time)',
      type: 'short-input',
      placeholder: 'ISO 8601 format (e.g., 2024-12-31T23:59:59Z)...',
      condition: { field: 'operation', value: 'incidentio_schedule_entries_list' },
    },
    // Schedule Overrides inputs
    {
      id: 'rotation_id',
      title: 'Rotation ID',
      type: 'short-input',
      placeholder: 'Enter rotation ID...',
      condition: { field: 'operation', value: 'incidentio_schedule_overrides_create' },
      required: true,
    },
    {
      id: 'user_id',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Enter user ID (provide one of: user_id, user_email, or user_slack_id)...',
      condition: { field: 'operation', value: 'incidentio_schedule_overrides_create' },
      required: false,
    },
    {
      id: 'user_email',
      title: 'User Email',
      type: 'short-input',
      placeholder: 'Enter user email (provide one of: user_id, user_email, or user_slack_id)...',
      condition: { field: 'operation', value: 'incidentio_schedule_overrides_create' },
      required: false,
    },
    {
      id: 'user_slack_id',
      title: 'User Slack ID',
      type: 'short-input',
      placeholder: 'Enter user Slack ID (provide one of: user_id, user_email, or user_slack_id)...',
      condition: { field: 'operation', value: 'incidentio_schedule_overrides_create' },
      required: false,
    },
    {
      id: 'start_at',
      title: 'Start At',
      type: 'short-input',
      placeholder: 'ISO 8601 format (e.g., 2024-01-01T00:00:00Z)...',
      condition: { field: 'operation', value: 'incidentio_schedule_overrides_create' },
      required: true,
    },
    {
      id: 'end_at',
      title: 'End At',
      type: 'short-input',
      placeholder: 'ISO 8601 format (e.g., 2024-12-31T23:59:59Z)...',
      condition: { field: 'operation', value: 'incidentio_schedule_overrides_create' },
      required: true,
    },
    // Escalation Paths inputs
    {
      id: 'path',
      title: 'Path Configuration',
      type: 'long-input',
      placeholder:
        'JSON array of escalation levels: [{"targets": [{"id": "...", "type": "...", "urgency": "..."}], "time_to_ack_seconds": 300}]',
      condition: {
        field: 'operation',
        value: 'incidentio_escalation_paths_create',
      },
      required: true,
    },
    {
      id: 'path',
      title: 'Path Configuration',
      type: 'long-input',
      placeholder:
        'JSON array of escalation levels (optional for update): [{"targets": [{"id": "...", "type": "...", "urgency": "..."}], "time_to_ack_seconds": 300}]',
      condition: {
        field: 'operation',
        value: 'incidentio_escalation_paths_update',
      },
      required: false,
    },
    {
      id: 'working_hours',
      title: 'Working Hours',
      type: 'long-input',
      placeholder:
        'Optional JSON array: [{"weekday": "monday", "start_time": "09:00", "end_time": "17:00"}]',
      condition: {
        field: 'operation',
        value: ['incidentio_escalation_paths_create', 'incidentio_escalation_paths_update'],
      },
    },
    // API Key (common)
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your incident.io API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: [
      'incidentio_incidents_list',
      'incidentio_incidents_create',
      'incidentio_incidents_show',
      'incidentio_incidents_update',
      'incidentio_actions_list',
      'incidentio_actions_show',
      'incidentio_follow_ups_list',
      'incidentio_follow_ups_show',
      'incidentio_users_list',
      'incidentio_users_show',
      'incidentio_workflows_list',
      'incidentio_workflows_show',
      'incidentio_workflows_update',
      'incidentio_workflows_delete',
      'incidentio_schedules_list',
      'incidentio_schedules_create',
      'incidentio_schedules_show',
      'incidentio_schedules_update',
      'incidentio_schedules_delete',
      'incidentio_escalations_list',
      'incidentio_escalations_create',
      'incidentio_escalations_show',
      'incidentio_custom_fields_list',
      'incidentio_custom_fields_create',
      'incidentio_custom_fields_show',
      'incidentio_custom_fields_update',
      'incidentio_custom_fields_delete',
      'incidentio_severities_list',
      'incidentio_incident_statuses_list',
      'incidentio_incident_types_list',
      'incidentio_incident_roles_list',
      'incidentio_incident_roles_create',
      'incidentio_incident_roles_show',
      'incidentio_incident_roles_update',
      'incidentio_incident_roles_delete',
      'incidentio_incident_timestamps_list',
      'incidentio_incident_timestamps_show',
      'incidentio_incident_updates_list',
      'incidentio_schedule_entries_list',
      'incidentio_schedule_overrides_create',
      'incidentio_escalation_paths_create',
      'incidentio_escalation_paths_show',
      'incidentio_escalation_paths_update',
      'incidentio_escalation_paths_delete',
    ],
    config: {
      tool: (params) => {
        // Convert page_size to a number if provided
        if (params.page_size) {
          params.page_size = Number(params.page_size)
        }

        // Convert notify_incident_channel from string to boolean
        if (params.notify_incident_channel !== undefined) {
          params.notify_incident_channel = params.notify_incident_channel === 'true'
        }

        switch (params.operation) {
          case 'incidentio_incidents_list':
            return 'incidentio_incidents_list'
          case 'incidentio_incidents_create':
            return 'incidentio_incidents_create'
          case 'incidentio_incidents_show':
            return 'incidentio_incidents_show'
          case 'incidentio_incidents_update':
            return 'incidentio_incidents_update'
          case 'incidentio_actions_list':
            return 'incidentio_actions_list'
          case 'incidentio_actions_show':
            return 'incidentio_actions_show'
          case 'incidentio_follow_ups_list':
            return 'incidentio_follow_ups_list'
          case 'incidentio_follow_ups_show':
            return 'incidentio_follow_ups_show'
          case 'incidentio_users_list':
            return 'incidentio_users_list'
          case 'incidentio_users_show':
            return 'incidentio_users_show'
          case 'incidentio_workflows_list':
            return 'incidentio_workflows_list'
          case 'incidentio_workflows_show':
            return 'incidentio_workflows_show'
          case 'incidentio_workflows_update':
            return 'incidentio_workflows_update'
          case 'incidentio_workflows_delete':
            return 'incidentio_workflows_delete'
          case 'incidentio_schedules_list':
            return 'incidentio_schedules_list'
          case 'incidentio_schedules_create':
            return 'incidentio_schedules_create'
          case 'incidentio_schedules_show':
            return 'incidentio_schedules_show'
          case 'incidentio_schedules_update':
            return 'incidentio_schedules_update'
          case 'incidentio_schedules_delete':
            return 'incidentio_schedules_delete'
          case 'incidentio_escalations_list':
            return 'incidentio_escalations_list'
          case 'incidentio_escalations_create':
            return 'incidentio_escalations_create'
          case 'incidentio_escalations_show':
            return 'incidentio_escalations_show'
          case 'incidentio_custom_fields_list':
            return 'incidentio_custom_fields_list'
          case 'incidentio_custom_fields_create':
            return 'incidentio_custom_fields_create'
          case 'incidentio_custom_fields_show':
            return 'incidentio_custom_fields_show'
          case 'incidentio_custom_fields_update':
            return 'incidentio_custom_fields_update'
          case 'incidentio_custom_fields_delete':
            return 'incidentio_custom_fields_delete'
          case 'incidentio_severities_list':
            return 'incidentio_severities_list'
          case 'incidentio_incident_statuses_list':
            return 'incidentio_incident_statuses_list'
          case 'incidentio_incident_types_list':
            return 'incidentio_incident_types_list'
          case 'incidentio_incident_roles_list':
            return 'incidentio_incident_roles_list'
          case 'incidentio_incident_roles_create':
            return 'incidentio_incident_roles_create'
          case 'incidentio_incident_roles_show':
            return 'incidentio_incident_roles_show'
          case 'incidentio_incident_roles_update':
            return 'incidentio_incident_roles_update'
          case 'incidentio_incident_roles_delete':
            return 'incidentio_incident_roles_delete'
          case 'incidentio_incident_timestamps_list':
            return 'incidentio_incident_timestamps_list'
          case 'incidentio_incident_timestamps_show':
            return 'incidentio_incident_timestamps_show'
          case 'incidentio_incident_updates_list':
            return 'incidentio_incident_updates_list'
          case 'incidentio_schedule_entries_list':
            return 'incidentio_schedule_entries_list'
          case 'incidentio_schedule_overrides_create':
            return 'incidentio_schedule_overrides_create'
          case 'incidentio_escalation_paths_create':
            return 'incidentio_escalation_paths_create'
          case 'incidentio_escalation_paths_show':
            return 'incidentio_escalation_paths_show'
          case 'incidentio_escalation_paths_update':
            return 'incidentio_escalation_paths_update'
          case 'incidentio_escalation_paths_delete':
            return 'incidentio_escalation_paths_delete'
          default:
            return 'incidentio_incidents_list'
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'incident.io API key' },
    // Common fields
    id: { type: 'string', description: 'Resource ID' },
    name: { type: 'string', description: 'Resource name' },
    page_size: { type: 'number', description: 'Number of results per page' },
    after: { type: 'string', description: 'Pagination cursor' },
    // Incident fields
    summary: { type: 'string', description: 'Incident summary' },
    severity_id: { type: 'string', description: 'Severity ID' },
    incident_type_id: { type: 'string', description: 'Incident type ID' },
    incident_status_id: { type: 'string', description: 'Incident status ID' },
    visibility: { type: 'string', description: 'Incident visibility' },
    incident_id: { type: 'string', description: 'Incident ID for filtering' },
    notify_incident_channel: {
      type: 'boolean',
      description: 'Whether to notify the incident channel',
    },
    // Workflow fields
    folder: { type: 'string', description: 'Workflow folder' },
    state: { type: 'string', description: 'Workflow state' },
    // Schedule fields
    timezone: { type: 'string', description: 'Schedule timezone' },
    // Custom field fields
    description: { type: 'string', description: 'Custom field description' },
    field_type: { type: 'string', description: 'Custom field type' },
    idempotency_key: { type: 'string', description: 'Unique key to prevent duplicate creation' },
    // Incident Roles fields
    role_type: { type: 'string', description: 'Type of incident role' },
    required: { type: 'boolean', description: 'Whether the role is required' },
    // Schedule Entries/Overrides fields
    schedule_id: { type: 'string', description: 'Schedule ID' },
    from: { type: 'string', description: 'Start date/time for filtering' },
    to: { type: 'string', description: 'End date/time for filtering' },
    user_id: { type: 'string', description: 'User ID' },
    start_at: { type: 'string', description: 'Start date/time' },
    end_at: { type: 'string', description: 'End date/time' },
    layer_id: { type: 'string', description: 'Schedule layer ID' },
    // Escalation Paths fields
    path: { type: 'json', description: 'Escalation path configuration' },
    working_hours: { type: 'json', description: 'Working hours configuration' },
  },
  outputs: {
    // Incidents
    incidents: { type: 'json', description: 'List of incidents' },
    incident: { type: 'json', description: 'Incident details' },
    // Actions
    actions: { type: 'json', description: 'List of actions' },
    action: { type: 'json', description: 'Action details' },
    // Follow-ups
    follow_ups: { type: 'json', description: 'List of follow-ups' },
    follow_up: { type: 'json', description: 'Follow-up details' },
    // Users
    users: { type: 'json', description: 'List of users' },
    user: { type: 'json', description: 'User details' },
    // Workflows
    workflows: { type: 'json', description: 'List of workflows' },
    workflow: { type: 'json', description: 'Workflow details' },
    // Schedules
    schedules: { type: 'json', description: 'List of schedules' },
    schedule: { type: 'json', description: 'Schedule details' },
    // Escalations
    escalations: { type: 'json', description: 'List of escalations' },
    escalation: { type: 'json', description: 'Escalation details' },
    // Custom Fields
    custom_fields: { type: 'json', description: 'List of custom fields' },
    custom_field: { type: 'json', description: 'Custom field details' },
    // Reference Data
    severities: { type: 'json', description: 'List of severities' },
    incident_statuses: { type: 'json', description: 'List of incident statuses' },
    incident_types: { type: 'json', description: 'List of incident types' },
    // Incident Roles
    incident_roles: { type: 'json', description: 'List of incident roles' },
    incident_role: { type: 'json', description: 'Incident role details' },
    // Incident Timestamps
    incident_timestamps: { type: 'json', description: 'List of incident timestamps' },
    incident_timestamp: { type: 'json', description: 'Incident timestamp details' },
    // Incident Updates
    incident_updates: { type: 'json', description: 'List of incident updates' },
    // Schedule Entries
    schedule_entries: { type: 'json', description: 'List of schedule entries' },
    // Schedule Overrides
    schedule_override: { type: 'json', description: 'Schedule override details' },
    // Escalation Paths
    escalation_path: { type: 'json', description: 'Escalation path details' },
    // General
    message: { type: 'string', description: 'Operation result message' },
    pagination_meta: { type: 'json', description: 'Pagination metadata' },
  },
}
