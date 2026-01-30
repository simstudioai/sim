// Common types for incident.io tools
import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Output property definitions for incident.io API responses.
 * @see https://api-docs.incident.io/
 */

/**
 * Output definition for severity objects.
 * @see https://api-docs.incident.io/#tag/Severities
 */
export const INCIDENTIO_SEVERITY_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Severity ID' },
  name: { type: 'string', description: 'Severity name (e.g., Critical, Major, Minor)' },
  description: { type: 'string', description: 'Severity description' },
  rank: { type: 'number', description: 'Severity rank (lower = more severe)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for status objects.
 * @see https://api-docs.incident.io/#tag/Incident-Statuses
 */
export const INCIDENTIO_STATUS_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Status ID' },
  name: { type: 'string', description: 'Status name' },
  description: { type: 'string', description: 'Status description' },
  category: {
    type: 'string',
    description: 'Status category (triage, active, post-incident, closed)',
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for incident type objects.
 * @see https://api-docs.incident.io/#tag/Incident-Types
 */
export const INCIDENTIO_INCIDENT_TYPE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Incident type ID' },
  name: { type: 'string', description: 'Incident type name' },
  description: { type: 'string', description: 'Incident type description' },
  is_default: { type: 'boolean', description: 'Whether this is the default incident type' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for user objects.
 * @see https://api-docs.incident.io/#tag/Users
 */
export const INCIDENTIO_USER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'User ID' },
  name: { type: 'string', description: 'User display name' },
  email: { type: 'string', description: 'User email address' },
  role: { type: 'string', description: 'User role' },
  slack_user_id: { type: 'string', description: 'Slack user ID', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for incident objects.
 * @see https://api-docs.incident.io/#tag/Incidents
 */
export const INCIDENTIO_INCIDENT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Incident ID' },
  name: { type: 'string', description: 'Incident name/title' },
  summary: { type: 'string', description: 'Incident summary', optional: true },
  description: { type: 'string', description: 'Incident description', optional: true },
  mode: {
    type: 'string',
    description: 'Incident mode (standard, retrospective, test)',
    optional: true,
  },
  call_url: { type: 'string', description: 'Video call URL', optional: true },
  severity: {
    type: 'object',
    description: 'Incident severity',
    optional: true,
    properties: INCIDENTIO_SEVERITY_OUTPUT_PROPERTIES,
  },
  status: {
    type: 'object',
    description: 'Current incident status',
    optional: true,
    properties: INCIDENTIO_STATUS_OUTPUT_PROPERTIES,
  },
  incident_type: {
    type: 'object',
    description: 'Incident type',
    optional: true,
    properties: INCIDENTIO_INCIDENT_TYPE_OUTPUT_PROPERTIES,
  },
  created_at: { type: 'string', description: 'When the incident was created (ISO 8601)' },
  updated_at: { type: 'string', description: 'When the incident was last updated (ISO 8601)' },
  incident_url: { type: 'string', description: 'URL to the incident page', optional: true },
  slack_channel_id: { type: 'string', description: 'Slack channel ID', optional: true },
  slack_channel_name: { type: 'string', description: 'Slack channel name', optional: true },
  visibility: {
    type: 'string',
    description: 'Incident visibility (public, private)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete incident output definition
 */
export const INCIDENTIO_INCIDENT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Incident.io incident object',
  properties: INCIDENTIO_INCIDENT_OUTPUT_PROPERTIES,
}

/**
 * Output definition for action objects.
 * @see https://api-docs.incident.io/#tag/Actions
 */
export const INCIDENTIO_ACTION_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Action ID' },
  description: { type: 'string', description: 'Action description' },
  assignee: {
    type: 'object',
    description: 'User assigned to the action',
    optional: true,
    properties: INCIDENTIO_USER_OUTPUT_PROPERTIES,
  },
  status: { type: 'string', description: 'Action status (outstanding, completed, deleted)' },
  due_at: { type: 'string', description: 'Due date/time', optional: true },
  created_at: { type: 'string', description: 'When the action was created' },
  updated_at: { type: 'string', description: 'When the action was last updated' },
  incident_id: { type: 'string', description: 'Associated incident ID', optional: true },
  completed_at: { type: 'string', description: 'When the action was completed', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete action output definition
 */
export const INCIDENTIO_ACTION_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Incident.io action object',
  properties: INCIDENTIO_ACTION_OUTPUT_PROPERTIES,
}

/**
 * Output definition for follow-up objects.
 * @see https://api-docs.incident.io/#tag/Follow-ups
 */
export const INCIDENTIO_FOLLOW_UP_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Follow-up ID' },
  title: { type: 'string', description: 'Follow-up title' },
  description: { type: 'string', description: 'Follow-up description', optional: true },
  assignee: {
    type: 'object',
    description: 'User assigned to the follow-up',
    optional: true,
    properties: INCIDENTIO_USER_OUTPUT_PROPERTIES,
  },
  status: { type: 'string', description: 'Follow-up status' },
  created_at: { type: 'string', description: 'When the follow-up was created' },
  updated_at: { type: 'string', description: 'When the follow-up was last updated' },
  incident_id: { type: 'string', description: 'Associated incident ID', optional: true },
  completed_at: { type: 'string', description: 'When the follow-up was completed', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete follow-up output definition
 */
export const INCIDENTIO_FOLLOW_UP_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Incident.io follow-up object',
  properties: INCIDENTIO_FOLLOW_UP_OUTPUT_PROPERTIES,
}

/**
 * Output definition for workflow objects.
 * @see https://api-docs.incident.io/#tag/Workflows
 */
export const INCIDENTIO_WORKFLOW_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Workflow ID' },
  name: { type: 'string', description: 'Workflow name' },
  state: { type: 'string', description: 'Workflow state (active, draft, disabled)' },
  folder: { type: 'string', description: 'Workflow folder', optional: true },
  created_at: { type: 'string', description: 'When the workflow was created', optional: true },
  updated_at: { type: 'string', description: 'When the workflow was last updated', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete workflow output definition
 */
export const INCIDENTIO_WORKFLOW_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Incident.io workflow object',
  properties: INCIDENTIO_WORKFLOW_OUTPUT_PROPERTIES,
}

/**
 * Output definition for custom field objects.
 * @see https://api-docs.incident.io/#tag/Custom-Fields
 */
export const INCIDENTIO_CUSTOM_FIELD_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Custom field ID' },
  name: { type: 'string', description: 'Custom field name' },
  description: { type: 'string', description: 'Custom field description', optional: true },
  field_type: {
    type: 'string',
    description: 'Field type (text, single_select, multi_select, numeric, link)',
  },
  created_at: { type: 'string', description: 'When the field was created' },
  updated_at: { type: 'string', description: 'When the field was last updated' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete custom field output definition
 */
export const INCIDENTIO_CUSTOM_FIELD_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Incident.io custom field object',
  properties: INCIDENTIO_CUSTOM_FIELD_OUTPUT_PROPERTIES,
}

/**
 * Output definition for schedule objects.
 * @see https://api-docs.incident.io/#tag/Schedules
 */
export const INCIDENTIO_SCHEDULE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Schedule ID' },
  name: { type: 'string', description: 'Schedule name' },
  timezone: { type: 'string', description: 'Schedule timezone' },
  created_at: { type: 'string', description: 'When the schedule was created', optional: true },
  updated_at: { type: 'string', description: 'When the schedule was last updated', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete schedule output definition
 */
export const INCIDENTIO_SCHEDULE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Incident.io schedule object',
  properties: INCIDENTIO_SCHEDULE_OUTPUT_PROPERTIES,
}

/**
 * Output definition for incident role objects.
 * @see https://api-docs.incident.io/#tag/Incident-Roles
 */
export const INCIDENTIO_INCIDENT_ROLE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Incident role ID' },
  name: { type: 'string', description: 'Role name' },
  description: { type: 'string', description: 'Role description', optional: true },
  instructions: { type: 'string', description: 'Role instructions' },
  shortform: { type: 'string', description: 'Role shortform/abbreviation' },
  role_type: { type: 'string', description: 'Role type (lead, custom)' },
  required: { type: 'boolean', description: 'Whether the role is required' },
  created_at: { type: 'string', description: 'When the role was created' },
  updated_at: { type: 'string', description: 'When the role was last updated' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete incident role output definition
 */
export const INCIDENTIO_INCIDENT_ROLE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Incident.io incident role object',
  properties: INCIDENTIO_INCIDENT_ROLE_OUTPUT_PROPERTIES,
}

/**
 * Pagination output properties
 */
export const INCIDENTIO_PAGINATION_OUTPUT_PROPERTIES = {
  after: { type: 'string', description: 'Cursor for next page', optional: true },
  page_size: { type: 'number', description: 'Number of items per page' },
  total_record_count: { type: 'number', description: 'Total number of records', optional: true },
} as const satisfies Record<string, OutputProperty>

// Common parameters for all incident.io tools
export interface IncidentioBaseParams {
  apiKey: string
}

// Incident types
export interface IncidentioIncidentsListParams extends IncidentioBaseParams {
  page_size?: number
  after?: string
}

export interface IncidentioIncident {
  id: string
  name: string
  summary?: string
  description?: string
  mode?: string
  call_url?: string
  severity?: {
    id: string
    name: string
    rank: number
  }
  status?: {
    id: string
    name: string
    category: string
  }
  incident_type?: {
    id: string
    name: string
  }
  created_at: string
  updated_at: string
  incident_url?: string
  slack_channel_id?: string
  slack_channel_name?: string
  visibility?: string
}

export interface IncidentioIncidentsListResponse extends ToolResponse {
  output: {
    incidents: IncidentioIncident[]
    pagination_meta?: {
      after?: string
      page_size: number
      total_record_count?: number
    }
  }
}

export interface IncidentioIncidentsCreateParams extends IncidentioBaseParams {
  idempotency_key: string
  name?: string
  summary?: string
  severity_id: string
  incident_type_id?: string
  incident_status_id?: string
  visibility: string
}

export interface IncidentioIncidentsCreateResponse extends ToolResponse {
  output: {
    incident: IncidentioIncident
  }
}

export interface IncidentioIncidentsShowParams extends IncidentioBaseParams {
  id: string
}

export interface IncidentioIncidentDetailed extends IncidentioIncident {
  description?: string
  mode?: string
  permalink?: string
  custom_field_entries?: Array<{
    custom_field: {
      id: string
      name: string
      field_type: string
    }
    values: Array<{
      value_text?: string
      value_link?: string
      value_numeric?: string
    }>
  }>
  incident_role_assignments?: Array<{
    role: {
      id: string
      name: string
      role_type: string
    }
    assignee?: {
      id: string
      name: string
      email: string
    }
  }>
}

export interface IncidentioIncidentsShowResponse extends ToolResponse {
  output: {
    incident: IncidentioIncidentDetailed
  }
}

export interface IncidentioIncidentsUpdateParams extends IncidentioBaseParams {
  id: string
  name?: string
  summary?: string
  severity_id?: string
  incident_status_id?: string
  incident_type_id?: string
  notify_incident_channel: boolean
}

export interface IncidentioIncidentsUpdateResponse extends ToolResponse {
  output: {
    incident: IncidentioIncident
  }
}

// Action types
export interface IncidentioActionsListParams extends IncidentioBaseParams {
  incident_id?: string
  page_size?: number
}

export interface IncidentioAction {
  id: string
  description: string
  assignee?: {
    id: string
    name: string
    email: string
    role?: string
    slack_user_id?: string
  }
  status: string
  due_at?: string
  created_at: string
  updated_at: string
  incident_id?: string
  creator?: {
    id: string
    name: string
    email: string
  }
  completed_at?: string
  external_issue_reference?: {
    provider: string
    issue_name: string
    issue_permalink: string
  }
}

export interface IncidentioActionsListResponse extends ToolResponse {
  output: {
    actions: IncidentioAction[]
  }
}

export interface IncidentioActionsShowParams extends IncidentioBaseParams {
  id: string
}

export interface IncidentioActionsShowResponse extends ToolResponse {
  output: {
    action: IncidentioAction
  }
}

// Follow-up types
export interface IncidentioFollowUpsListParams extends IncidentioBaseParams {
  incident_id?: string
  page_size?: number
}

export interface IncidentioFollowUp {
  id: string
  title: string
  description?: string
  assignee?: {
    id: string
    name: string
    email: string
    role?: string
    slack_user_id?: string
  }
  status: string
  priority?: {
    id: string
    name: string
    description: string
    rank: number
  }
  created_at: string
  updated_at: string
  incident_id?: string
  creator?: {
    id: string
    name: string
    email: string
  }
  completed_at?: string
  labels?: string[]
  external_issue_reference?: {
    provider: string
    issue_name: string
    issue_permalink: string
  }
}

export interface IncidentioFollowUpsListResponse extends ToolResponse {
  output: {
    follow_ups: IncidentioFollowUp[]
  }
}

export interface IncidentioFollowUpsShowParams extends IncidentioBaseParams {
  id: string
}

export interface IncidentioFollowUpsShowResponse extends ToolResponse {
  output: {
    follow_up: IncidentioFollowUp
  }
}

// Workflow types
export interface Workflow {
  id: string
  name: string
  state: 'active' | 'draft' | 'disabled'
  folder?: string
  created_at?: string
  updated_at?: string
}

// Workflows List tool types
export interface WorkflowsListParams extends IncidentioBaseParams {
  page_size?: number
  after?: string
}

export interface WorkflowsListResponse extends ToolResponse {
  output: {
    workflows: Workflow[]
    pagination_meta?: {
      after?: string
      page_size: number
    }
  }
}

// Workflows Create tool types
export interface WorkflowsCreateParams extends IncidentioBaseParams {
  name: string
  folder?: string
  state?: 'active' | 'draft' | 'disabled'
  trigger?: string
  steps?: string
  condition_groups?: string
  runs_on_incidents?: 'newly_created' | 'newly_created_and_active' | 'active' | 'all'
  runs_on_incident_modes?: string
  include_private_incidents?: boolean
  continue_on_step_error?: boolean
  once_for?: string
  expressions?: string
  delay?: string
}

export interface WorkflowsCreateResponse extends ToolResponse {
  output: {
    workflow: Workflow
  }
}

// Workflows Show tool types
export interface WorkflowsShowParams extends IncidentioBaseParams {
  id: string
}

export interface WorkflowsShowResponse extends ToolResponse {
  output: {
    workflow: Workflow
  }
}

// Workflows Update tool types
export interface WorkflowsUpdateParams extends IncidentioBaseParams {
  id: string
  name?: string
  state?: 'active' | 'draft' | 'disabled'
  folder?: string
}

export interface WorkflowsUpdateResponse extends ToolResponse {
  output: {
    workflow: Workflow
  }
}

// Workflows Delete tool types
export interface WorkflowsDeleteParams extends IncidentioBaseParams {
  id: string
}

export interface WorkflowsDeleteResponse extends ToolResponse {
  output: {
    message: string
  }
}

// Custom field types
export type CustomFieldType = 'text' | 'single_select' | 'multi_select' | 'numeric' | 'link'

export interface CustomField {
  id: string
  name: string
  description?: string
  field_type: CustomFieldType
  created_at: string
  updated_at: string
  options?: CustomFieldOption[]
}

export interface CustomFieldOption {
  id: string
  value: string
  sort_key: number
}

// List custom fields
export interface CustomFieldsListParams extends IncidentioBaseParams {}

export interface CustomFieldsListResponse extends ToolResponse {
  output: {
    custom_fields: CustomField[]
  }
}

// Create custom field
export interface CustomFieldsCreateParams extends IncidentioBaseParams {
  name: string
  description?: string
  field_type: CustomFieldType
}

export interface CustomFieldsCreateResponse extends ToolResponse {
  output: {
    custom_field: CustomField
  }
}

// Show custom field
export interface CustomFieldsShowParams extends IncidentioBaseParams {
  id: string
}

export interface CustomFieldsShowResponse extends ToolResponse {
  output: {
    custom_field: CustomField
  }
}

// Update custom field
export interface CustomFieldsUpdateParams extends IncidentioBaseParams {
  id: string
  name?: string
  description?: string
}

export interface CustomFieldsUpdateResponse extends ToolResponse {
  output: {
    custom_field: CustomField
  }
}

// Delete custom field
export interface CustomFieldsDeleteParams extends IncidentioBaseParams {
  id: string
}

export interface CustomFieldsDeleteResponse extends ToolResponse {
  output: {
    message: string
  }
}

// Users list tool types
export interface IncidentioUsersListParams extends IncidentioBaseParams {
  page_size?: number
}

export interface IncidentioUser {
  id: string
  name: string
  email: string
  role: string
}

export interface IncidentioUsersListResponse extends ToolResponse {
  output: {
    users: IncidentioUser[]
  }
}

// Users show tool types
export interface IncidentioUsersShowParams extends IncidentioBaseParams {
  id: string
}

export interface IncidentioUsersShowResponse extends ToolResponse {
  output: {
    user: IncidentioUser
  }
}

// Severities list tool types
export interface IncidentioSeveritiesListParams extends IncidentioBaseParams {}

export interface IncidentioSeverity {
  id: string
  name: string
  description: string
  rank: number
}

export interface IncidentioSeveritiesListResponse extends ToolResponse {
  output: {
    severities: IncidentioSeverity[]
  }
}

// Incident statuses list tool types
export interface IncidentioIncidentStatusesListParams extends IncidentioBaseParams {}

export interface IncidentioIncidentStatus {
  id: string
  name: string
  description: string
  category: string
}

export interface IncidentioIncidentStatusesListResponse extends ToolResponse {
  output: {
    incident_statuses: IncidentioIncidentStatus[]
  }
}

// Incident types list tool types
export interface IncidentioIncidentTypesListParams extends IncidentioBaseParams {}

export interface IncidentioIncidentType {
  id: string
  name: string
  description: string
  is_default: boolean
}

export interface IncidentioIncidentTypesListResponse extends ToolResponse {
  output: {
    incident_types: IncidentioIncidentType[]
  }
}

export type IncidentioResponse =
  | IncidentioIncidentsListResponse
  | IncidentioIncidentsCreateResponse
  | IncidentioIncidentsShowResponse
  | IncidentioIncidentsUpdateResponse
  | IncidentioActionsListResponse
  | IncidentioActionsShowResponse
  | IncidentioFollowUpsListResponse
  | IncidentioFollowUpsShowResponse
  | WorkflowsListResponse
  | WorkflowsCreateResponse
  | WorkflowsShowResponse
  | WorkflowsUpdateResponse
  | WorkflowsDeleteResponse
  | CustomFieldsListResponse
  | CustomFieldsCreateResponse
  | CustomFieldsShowResponse
  | CustomFieldsUpdateResponse
  | CustomFieldsDeleteResponse
  | IncidentioUsersListResponse
  | IncidentioUsersShowResponse
  | IncidentioSeveritiesListResponse
  | IncidentioIncidentStatusesListResponse
  | IncidentioIncidentTypesListResponse
  | IncidentioEscalationsListResponse
  | IncidentioEscalationsCreateResponse
  | IncidentioEscalationsShowResponse
  | IncidentioSchedulesListResponse
  | IncidentioSchedulesCreateResponse
  | IncidentioSchedulesShowResponse
  | IncidentioSchedulesUpdateResponse
  | IncidentioSchedulesDeleteResponse
  | IncidentioIncidentRolesListResponse
  | IncidentioIncidentRolesCreateResponse
  | IncidentioIncidentRolesShowResponse
  | IncidentioIncidentRolesUpdateResponse
  | IncidentioIncidentRolesDeleteResponse
  | IncidentioIncidentTimestampsListResponse
  | IncidentioIncidentTimestampsShowResponse
  | IncidentioIncidentUpdatesListResponse
  | IncidentioScheduleEntriesListResponse
  | IncidentioScheduleOverridesCreateResponse
  | IncidentioEscalationPathsCreateResponse
  | IncidentioEscalationPathsShowResponse
  | IncidentioEscalationPathsUpdateResponse
  | IncidentioEscalationPathsDeleteResponse

// Escalations types
export interface IncidentioEscalationsListParams extends IncidentioBaseParams {
  page_size?: number
}

export interface IncidentioEscalation {
  id: string
  name: string
  created_at?: string
  updated_at?: string
}

export interface IncidentioEscalationsListResponse extends ToolResponse {
  output: {
    escalations: IncidentioEscalation[]
  }
}

export interface IncidentioEscalationsCreateParams extends IncidentioBaseParams {
  idempotency_key: string
  title: string
  escalation_path_id?: string
  user_ids?: string
}

export interface IncidentioEscalationsCreateResponse extends ToolResponse {
  output: {
    escalation: IncidentioEscalation
  }
}

export interface IncidentioEscalationsShowParams extends IncidentioBaseParams {
  id: string
}

export interface IncidentioEscalationsShowResponse extends ToolResponse {
  output: {
    escalation: IncidentioEscalation
  }
}

// Schedules types
export interface IncidentioSchedulesListParams extends IncidentioBaseParams {
  page_size?: number
  after?: string
}

export interface IncidentioSchedule {
  id: string
  name: string
  timezone: string
  created_at?: string
  updated_at?: string
}

export interface IncidentioSchedulesListResponse extends ToolResponse {
  output: {
    schedules: IncidentioSchedule[]
    pagination_meta?: {
      after?: string
      page_size: number
    }
  }
}

export interface IncidentioSchedulesCreateParams extends IncidentioBaseParams {
  name: string
  timezone: string
  config: string
}

export interface IncidentioSchedulesCreateResponse extends ToolResponse {
  output: {
    schedule: IncidentioSchedule
  }
}

export interface IncidentioSchedulesShowParams extends IncidentioBaseParams {
  id: string
}

export interface IncidentioSchedulesShowResponse extends ToolResponse {
  output: {
    schedule: IncidentioSchedule
  }
}

export interface IncidentioSchedulesUpdateParams extends IncidentioBaseParams {
  id: string
  name?: string
  timezone?: string
  config?: string
}

export interface IncidentioSchedulesUpdateResponse extends ToolResponse {
  output: {
    schedule: IncidentioSchedule
  }
}

export interface IncidentioSchedulesDeleteParams extends IncidentioBaseParams {
  id: string
}

export interface IncidentioSchedulesDeleteResponse extends ToolResponse {
  output: {
    message: string
  }
}

// Incident Roles types
export interface IncidentioIncidentRole {
  id: string
  name: string
  description?: string
  instructions: string
  shortform: string
  role_type: string
  required: boolean
  created_at: string
  updated_at: string
}

export interface IncidentioIncidentRolesListParams extends IncidentioBaseParams {}

export interface IncidentioIncidentRolesListResponse extends ToolResponse {
  output: {
    incident_roles: IncidentioIncidentRole[]
  }
}

export interface IncidentioIncidentRolesCreateParams extends IncidentioBaseParams {
  name: string
  description: string
  instructions: string
  shortform: string
}

export interface IncidentioIncidentRolesCreateResponse extends ToolResponse {
  output: {
    incident_role: IncidentioIncidentRole
  }
}

export interface IncidentioIncidentRolesShowParams extends IncidentioBaseParams {
  id: string
}

export interface IncidentioIncidentRolesShowResponse extends ToolResponse {
  output: {
    incident_role: IncidentioIncidentRole
  }
}

export interface IncidentioIncidentRolesUpdateParams extends IncidentioBaseParams {
  id: string
  name: string
  description: string
  instructions: string
  shortform: string
}

export interface IncidentioIncidentRolesUpdateResponse extends ToolResponse {
  output: {
    incident_role: IncidentioIncidentRole
  }
}

export interface IncidentioIncidentRolesDeleteParams extends IncidentioBaseParams {
  id: string
}

export interface IncidentioIncidentRolesDeleteResponse extends ToolResponse {
  output: {
    message: string
  }
}

// Incident Timestamps types
export interface IncidentioIncidentTimestamp {
  id: string
  name: string
  rank: number
  created_at: string
  updated_at: string
}

export interface IncidentioIncidentTimestampsListParams extends IncidentioBaseParams {}

export interface IncidentioIncidentTimestampsListResponse extends ToolResponse {
  output: {
    incident_timestamps: IncidentioIncidentTimestamp[]
  }
}

export interface IncidentioIncidentTimestampsShowParams extends IncidentioBaseParams {
  id: string
}

export interface IncidentioIncidentTimestampsShowResponse extends ToolResponse {
  output: {
    incident_timestamp: IncidentioIncidentTimestamp
  }
}

// Incident Updates types
export interface IncidentioIncidentUpdate {
  id: string
  incident_id: string
  message: string
  new_severity?: {
    id: string
    name: string
    rank: number
  }
  new_status?: {
    id: string
    name: string
    category: string
  }
  updater: {
    id: string
    name: string
    email: string
  }
  created_at: string
  updated_at: string
}

export interface IncidentioIncidentUpdatesListParams extends IncidentioBaseParams {
  incident_id?: string
  page_size?: number
  after?: string
}

export interface IncidentioIncidentUpdatesListResponse extends ToolResponse {
  output: {
    incident_updates: IncidentioIncidentUpdate[]
    pagination_meta?: {
      after?: string
      page_size: number
    }
  }
}

// Schedule Entries types
export interface IncidentioScheduleEntry {
  id: string
  schedule_id: string
  user: {
    id: string
    name: string
    email: string
  }
  start_at: string
  end_at: string
  layer_id: string
  created_at: string
  updated_at: string
}

export interface IncidentioScheduleEntriesListParams extends IncidentioBaseParams {
  schedule_id: string
  entry_window_start?: string
  entry_window_end?: string
  page_size?: number
  after?: string
}

export interface IncidentioScheduleEntriesListResponse extends ToolResponse {
  output: {
    schedule_entries: IncidentioScheduleEntry[]
    pagination_meta?: {
      after?: string
      after_url?: string
      page_size: number
    }
  }
}

// Schedule Overrides types
export interface IncidentioScheduleOverride {
  id: string
  rotation_id: string
  schedule_id: string
  user: {
    id: string
    name: string
    email: string
  }
  start_at: string
  end_at: string
  created_at: string
  updated_at: string
}

export interface IncidentioScheduleOverridesCreateParams extends IncidentioBaseParams {
  rotation_id: string
  schedule_id: string
  user_id?: string
  user_email?: string
  user_slack_id?: string
  start_at: string
  end_at: string
}

export interface IncidentioScheduleOverridesCreateResponse extends ToolResponse {
  output: {
    override: IncidentioScheduleOverride
  }
}

// Escalation Paths types
export interface IncidentioEscalationPathTarget {
  id: string
  type: string
  schedule_id?: string
  user_id?: string
  urgency: string
}

export interface IncidentioEscalationPathLevel {
  targets: IncidentioEscalationPathTarget[]
  time_to_ack_seconds: number
}

export interface IncidentioEscalationPath {
  id: string
  name: string
  path: IncidentioEscalationPathLevel[]
  working_hours?: Array<{
    weekday: string
    start_time: string
    end_time: string
  }>
  created_at: string
  updated_at: string
}

export interface IncidentioEscalationPathsCreateParams extends IncidentioBaseParams {
  name: string
  path: Array<{
    targets: Array<{
      id: string
      type: string
      schedule_id?: string
      user_id?: string
      urgency: string
    }>
    time_to_ack_seconds: number
  }>
  working_hours?: Array<{
    weekday: string
    start_time: string
    end_time: string
  }>
}

export interface IncidentioEscalationPathsCreateResponse extends ToolResponse {
  output: {
    escalation_path: IncidentioEscalationPath
  }
}

export interface IncidentioEscalationPathsShowParams extends IncidentioBaseParams {
  id: string
}

export interface IncidentioEscalationPathsShowResponse extends ToolResponse {
  output: {
    escalation_path: IncidentioEscalationPath
  }
}

export interface IncidentioEscalationPathsUpdateParams extends IncidentioBaseParams {
  id: string
  name?: string
  path?: Array<{
    targets: Array<{
      id: string
      type: string
      schedule_id?: string
      user_id?: string
      urgency: string
    }>
    time_to_ack_seconds: number
  }>
  working_hours?: Array<{
    weekday: string
    start_time: string
    end_time: string
  }>
}

export interface IncidentioEscalationPathsUpdateResponse extends ToolResponse {
  output: {
    escalation_path: IncidentioEscalationPath
  }
}

export interface IncidentioEscalationPathsDeleteParams extends IncidentioBaseParams {
  id: string
}

export interface IncidentioEscalationPathsDeleteResponse extends ToolResponse {
  output: {
    message: string
  }
}
