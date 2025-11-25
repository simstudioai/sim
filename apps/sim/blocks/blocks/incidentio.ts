import { IncidentioIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { IncidentioResponse } from '@/tools/incidentio/types'

export const IncidentioBlock: BlockConfig<IncidentioResponse> = {
  type: 'incidentio',
  name: 'incident.io',
  description: 'Manage incidents with incident.io',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate incident.io into the workflow. Manage incidents, actions, follow-ups, workflows, schedules, escalations, custom fields, and more.',
  docsLink: 'https://docs.sim.ai/tools/incidentio',
  category: 'tools',
  bgColor: '#7C3AED',
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
        { label: 'Create Workflow', id: 'incidentio_workflows_create' },
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
        ],
      },
    },
    // Incidents List operation inputs
    {
      id: 'after',
      title: 'After (Pagination)',
      type: 'short-input',
      placeholder: 'Cursor for pagination',
      condition: { field: 'operation', value: 'incidentio_incidents_list' },
    },
    // Incidents Create operation inputs
    {
      id: 'name',
      title: 'Incident Name',
      type: 'short-input',
      placeholder: 'Enter incident name...',
      condition: { field: 'operation', value: 'incidentio_incidents_create' },
      required: true,
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
      condition: {
        field: 'operation',
        value: ['incidentio_incidents_create', 'incidentio_incidents_update'],
      },
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
      id: 'visibility',
      title: 'Visibility',
      type: 'dropdown',
      options: [
        { label: 'Public', id: 'public' },
        { label: 'Private', id: 'private' },
      ],
      value: () => 'public',
      condition: { field: 'operation', value: 'incidentio_incidents_create' },
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
          'incidentio_incidents_update',
          'incidentio_workflows_create',
          'incidentio_workflows_update',
          'incidentio_schedules_create',
          'incidentio_schedules_update',
          'incidentio_escalations_create',
          'incidentio_custom_fields_create',
          'incidentio_custom_fields_update',
        ],
      },
      required: (params) =>
        params.operation === 'incidentio_workflows_create' ||
        params.operation === 'incidentio_schedules_create' ||
        params.operation === 'incidentio_escalations_create' ||
        params.operation === 'incidentio_custom_fields_create' ||
        params.operation === 'incidentio_custom_fields_update',
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
      condition: {
        field: 'operation',
        value: ['incidentio_workflows_create', 'incidentio_workflows_update'],
      },
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
      condition: {
        field: 'operation',
        value: ['incidentio_workflows_create', 'incidentio_workflows_update'],
      },
    },
    // Schedules inputs
    {
      id: 'timezone',
      title: 'Timezone',
      type: 'short-input',
      placeholder: 'e.g., America/New_York',
      condition: {
        field: 'operation',
        value: ['incidentio_schedules_create', 'incidentio_schedules_update'],
      },
      required: (params) => params.operation === 'incidentio_schedules_create',
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
      required: (params) =>
        params.operation === 'incidentio_custom_fields_create' ||
        params.operation === 'incidentio_custom_fields_update',
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
        { label: 'Datetime', id: 'datetime' },
        { label: 'Link', id: 'link' },
        { label: 'User', id: 'user' },
        { label: 'Team', id: 'team' },
      ],
      value: () => 'text',
      condition: { field: 'operation', value: 'incidentio_custom_fields_create' },
      required: true,
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
      'incidentio_workflows_create',
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
    ],
    config: {
      tool: (params) => {
        // Convert page_size to a number if provided
        if (params.page_size) {
          params.page_size = Number(params.page_size)
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
          case 'incidentio_workflows_create':
            return 'incidentio_workflows_create'
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
    // Workflow fields
    folder: { type: 'string', description: 'Workflow folder' },
    state: { type: 'string', description: 'Workflow state' },
    // Schedule fields
    timezone: { type: 'string', description: 'Schedule timezone' },
    // Custom field fields
    description: { type: 'string', description: 'Custom field description' },
    field_type: { type: 'string', description: 'Custom field type' },
    required: { type: 'boolean', description: 'Whether field is required' },
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
    // General
    message: { type: 'string', description: 'Operation result message' },
    pagination_meta: { type: 'json', description: 'Pagination metadata' },
  },
}
