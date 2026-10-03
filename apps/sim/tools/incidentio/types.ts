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
  permalink: {
    type: 'string',
    description: 'Permalink to the incident in incident.io',
    optional: true,
  },
  slack_channel_id: { type: 'string', description: 'Slack channel ID', optional: true },
  slack_channel_name: { type: 'string', description: 'Slack channel name', optional: true },
  visibility: {
    type: 'string',
    description: 'Incident visibility (public, private)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

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
 * Output definition for workflow objects.
 * @see https://api-docs.incident.io/#tag/Workflows
 */
export const INCIDENTIO_WORKFLOW_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Workflow ID' },
  name: { type: 'string', description: 'Workflow name' },
  trigger: { type: 'string', description: 'Workflow trigger' },
  once_for: { type: 'array', description: 'Fields that make the workflow run once' },
  version: { type: 'number', description: 'Workflow version' },
  expressions: { type: 'array', description: 'Workflow expressions' },
  condition_groups: { type: 'array', description: 'Workflow condition groups' },
  steps: { type: 'array', description: 'Workflow steps' },
  include_private_incidents: {
    type: 'boolean',
    description: 'Whether the workflow includes private incidents',
  },
  include_private_escalations: {
    type: 'boolean',
    description: 'Whether the workflow includes private escalations',
  },
  runs_on_incident_modes: { type: 'array', description: 'Incident modes the workflow runs on' },
  continue_on_step_error: {
    type: 'boolean',
    description: 'Whether execution continues after a step error',
  },
  runs_on_incidents: { type: 'string', description: 'Incident lifecycle filter' },
  state: { type: 'string', description: 'Workflow state (active, draft, disabled)' },
  delay: { type: 'object', description: 'Workflow delay configuration', optional: true },
  folder: { type: 'string', description: 'Workflow folder', optional: true },
  runs_from: { type: 'string', description: 'When the workflow runs from', optional: true },
  shortform: { type: 'string', description: 'Workflow shortform identifier', optional: true },
} as const satisfies Record<string, OutputProperty>

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
 * Pagination output properties
 */
export const INCIDENTIO_PAGINATION_OUTPUT_PROPERTIES = {
  after: { type: 'string', description: 'Cursor for next page', optional: true },
  page_size: { type: 'number', description: 'Number of items per page' },
  total_record_count: { type: 'number', description: 'Total number of records', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for alert objects.
 * @see https://docs.incident.io/api-reference
 */
export const INCIDENTIO_ALERT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Alert ID' },
  title: { type: 'string', description: 'Alert title, parsed from the alert payload' },
  status: { type: 'string', description: 'Alert status (firing, resolved)' },
  alert_source_id: { type: 'string', description: 'ID of the alert source this alert fired on' },
  deduplication_key: {
    type: 'string',
    description: 'Key that uniquely references this alert from its source',
  },
  description: { type: 'string', description: 'Alert description', optional: true },
  source_url: {
    type: 'string',
    description: 'Link to the alert in the upstream system',
    optional: true,
  },
  resolved_at: { type: 'string', description: 'When this alert was resolved', optional: true },
  created_at: { type: 'string', description: 'When this alert was created' },
  updated_at: { type: 'string', description: 'When this alert was last updated' },
  alert_group_ids: {
    type: 'array',
    description: 'IDs of every alert group this alert belongs to',
    optional: true,
    items: { type: 'string' },
  },
  attributes: {
    type: 'array',
    description: 'Attribute values parsed from the alert payload',
    optional: true,
    items: { type: 'object' },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for catalog type objects.
 * @see https://docs.incident.io/api-reference
 */
export const INCIDENTIO_CATALOG_TYPE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Catalog type ID' },
  name: { type: 'string', description: 'Human readable name of this type' },
  description: { type: 'string', description: 'Human readable description of this type' },
  type_name: {
    type: 'string',
    description: 'Type name used when defining attributes (e.g., Custom["Service"])',
  },
  engine_resource_type: {
    type: 'string',
    description: 'How this resource type is referenced in the incident.io engine',
  },
  categories: {
    type: 'array',
    description: 'Categories this type is considered part of',
    items: { type: 'string' },
  },
  color: { type: 'string', description: 'Display color of this type in the dashboard' },
  icon: { type: 'string', description: 'Display icon of this type in the dashboard' },
  ranked: { type: 'boolean', description: 'Whether entries of this type are ranked' },
  is_editable: {
    type: 'boolean',
    description: 'Whether this type can be edited (types synced externally cannot)',
  },
  use_name_as_identifier: {
    type: 'boolean',
    description: 'Whether entries can be referenced by name as well as external ID',
  },
  estimated_count: {
    type: 'number',
    description: 'Estimated number of entries for this type',
    optional: true,
  },
  is_team_type: {
    type: 'boolean',
    description: 'Whether this is the designated team type in team settings',
    optional: true,
  },
  registry_type: {
    type: 'string',
    description: 'The registry resource this type is synced from, if any',
    optional: true,
  },
  last_synced_at: { type: 'string', description: 'When this type was last synced', optional: true },
  owning_team_ids: {
    type: 'array',
    description: 'IDs of the teams that own this catalog type',
    optional: true,
    items: { type: 'string' },
  },
  schema: {
    type: 'object',
    description: 'Attribute schema for this catalog type',
    properties: {
      version: { type: 'number', description: 'Version number of this schema' },
      attributes: {
        type: 'array',
        description: 'Attributes of this catalog type',
        items: { type: 'object' },
      },
    },
  },
  annotations: { type: 'json', description: 'Metadata annotations tracked about this type' },
  created_at: { type: 'string', description: 'When this type was created' },
  updated_at: { type: 'string', description: 'When this type was last updated' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for team objects.
 * @see https://docs.incident.io/api-reference
 */
export const INCIDENTIO_TEAM_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Team ID' },
  name: { type: 'string', description: 'Team name' },
  members: {
    type: 'array',
    description: 'Members of the team',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'User ID' },
        name: { type: 'string', description: 'User display name' },
        email: { type: 'string', description: 'User email address', optional: true },
        slack_user_id: { type: 'string', description: 'Slack user ID', optional: true },
      },
    },
  },
  catalog_entry: {
    type: 'object',
    description: 'The catalog entry backing this team',
    properties: {
      id: { type: 'string', description: 'Catalog entry ID' },
      name: { type: 'string', description: 'Catalog entry name' },
      external_id: {
        type: 'string',
        description: 'Alternative ID for this entry, unique within the type',
        optional: true,
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

// Common parameters for all incident.io tools
export interface IncidentioBaseParams {
  apiKey: string
}

// Incident types
export interface IncidentioIncidentsListParams extends IncidentioBaseParams {
  page_size?: number
  after?: string
  sort_by?: 'created_at_newest_first' | 'created_at_oldest_first'
  filter_mode?: 'all' | 'any'
}

interface IncidentioIncident {
  id: string
  name: string
  summary?: string
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
  permalink?: string
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

interface IncidentioIncidentDetailed extends IncidentioIncident {
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
  incident_mode?: 'standard' | 'retrospective' | 'test' | 'tutorial' | 'stream'
}

interface IncidentioAction {
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
  incident_mode?: 'standard' | 'retrospective' | 'test' | 'tutorial' | 'stream'
}

interface IncidentioFollowUp {
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
  trigger: string
  once_for: unknown[]
  version: number
  expressions: unknown[]
  condition_groups: unknown[]
  steps: unknown[]
  include_private_incidents: boolean
  include_private_escalations: boolean
  runs_on_incident_modes: string[]
  continue_on_step_error: boolean
  runs_on_incidents: 'newly_created' | 'newly_created_and_active'
  state: 'active' | 'draft' | 'disabled' | 'error'
  delay?: unknown
  folder?: string
  runs_from?: string
  shortform?: string
}

// Workflows List tool types
export interface WorkflowsListParams extends IncidentioBaseParams {}

export interface WorkflowsListResponse extends ToolResponse {
  output: {
    workflows: Workflow[]
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
  runs_on_incidents?: 'newly_created' | 'newly_created_and_active'
  runs_on_incident_modes?: string
  include_private_incidents?: boolean
  continue_on_step_error?: boolean
  once_for?: string
  expressions?: string
  delay?: string
}

export interface WorkflowsCreateResponse extends ToolResponse {
  output: {
    management_meta?: Record<string, unknown>
    workflow: Workflow
  }
}

// Workflows Show tool types
export interface WorkflowsShowParams extends IncidentioBaseParams {
  id: string
  skip_step_upgrades?: boolean
}

export interface WorkflowsShowResponse extends ToolResponse {
  output: {
    management_meta?: Record<string, unknown>
    workflow: Workflow
  }
}

// Workflows Update tool types
export interface WorkflowsUpdateParams extends IncidentioBaseParams {
  id: string
  name: string
  steps: string
  condition_groups: string
  runs_on_incidents: 'newly_created' | 'newly_created_and_active'
  runs_on_incident_modes: string
  include_private_incidents: boolean
  continue_on_step_error: boolean
  once_for: string
  expressions: string
  state?: 'active' | 'draft' | 'disabled'
  folder?: string
  delay?: string
}

export interface WorkflowsUpdateResponse extends ToolResponse {
  output: {
    management_meta?: Record<string, unknown>
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

interface CustomField {
  id: string
  name: string
  description?: string
  field_type: CustomFieldType
  created_at: string
  updated_at: string
  options?: CustomFieldOption[]
}

interface CustomFieldOption {
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
  after?: string
  email?: string
  slack_user_id?: string
}

interface IncidentioUser {
  id: string
  name: string
  email: string
  role: string
}

export interface IncidentioUsersListResponse extends ToolResponse {
  output: {
    users: IncidentioUser[]
    pagination_meta?: {
      after: string
      page_size: number
      total_record_count?: number
    }
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

interface IncidentioSeverity {
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

interface IncidentioIncidentStatus {
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

interface IncidentioIncidentType {
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
  | IncidentioEscalationPathsListResponse
  | IncidentioEscalationPathsCreateResponse
  | IncidentioEscalationPathsShowResponse
  | IncidentioEscalationPathsUpdateResponse
  | IncidentioEscalationPathsDeleteResponse
  | IncidentioOnCallNowResponse
  | IncidentioScheduleOverridesListResponse
  | IncidentioAlertsListResponse
  | IncidentioAlertsShowResponse
  | IncidentioAlertsResolveResponse
  | IncidentioAlertEventsCreateResponse
  | IncidentioIncidentAlertsListResponse
  | IncidentioEscalationsCancelResponse
  | IncidentioCatalogTypesListResponse
  | IncidentioCatalogEntriesListResponse
  | IncidentioTeamsListResponse
  | IncidentioTeamsShowResponse
  | IncidentioFollowUpsCreateResponse
  | IncidentioFollowUpsUpdateResponse
  | IncidentioActionsCreateResponse
  | IncidentioActionsUpdateResponse
  | IncidentioIncidentParticipantsListResponse
  | IncidentioIncidentMembershipsCreateResponse
  | IncidentioIncidentMembershipsRevokeResponse

// Escalations types
export interface IncidentioEscalationsListParams extends IncidentioBaseParams {
  page_size?: number
  after?: string
}

interface IncidentioEscalation {
  id: string
  title: string
  status: string
  created_at?: string
  updated_at?: string
}

export interface IncidentioEscalationsListResponse extends ToolResponse {
  output: {
    escalations: IncidentioEscalation[]
    pagination_meta?: {
      after?: string
      page_size: number
    }
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

interface IncidentioSchedule {
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
interface IncidentioIncidentRole {
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
interface IncidentioIncidentTimestamp {
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
interface IncidentioIncidentUpdate {
  id: string
  incident_id: string
  message?: string
  merged_into_incident_id?: string
  new_severity?: {
    id: string
    name: string
    rank: number
  }
  new_incident_status: {
    id: string
    name: string
    category: string
  }
  updater: {
    user?: {
      id: string
      name: string
      email?: string
    }
  }
  created_at: string
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
interface IncidentioScheduleEntry {
  entry_id: string
  fingerprint: string
  rotation_id: string
  layer_id: string
  user: {
    id: string
    name: string
    email: string
  }
  start_at: string
  end_at: string
}

export interface IncidentioScheduleEntriesListParams extends IncidentioBaseParams {
  schedule_id: string
  entry_window_start?: string
  entry_window_end?: string
}

export interface IncidentioScheduleEntriesListResponse extends ToolResponse {
  output: {
    schedule_entries: {
      final: IncidentioScheduleEntry[]
      overrides: IncidentioScheduleEntry[]
      scheduled: IncidentioScheduleEntry[]
    }
    pagination_meta?: {
      after?: string
      after_url?: string
    }
  }
}

// Schedule Overrides types
interface IncidentioScheduleOverride {
  id: string
  layer_id: string
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
  layer_id: string
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
interface IncidentioEscalationPathTarget {
  id: string
  type: string
  schedule_id?: string
  user_id?: string
  urgency: string
}

interface IncidentioEscalationPathLevel {
  targets: IncidentioEscalationPathTarget[]
  time_to_ack_seconds: number
}

interface IncidentioEscalationPath {
  id: string
  name: string
  path: IncidentioEscalationPathLevel[]
  working_hours?: Array<{
    weekday: string
    start_time: string
    end_time: string
  }>
}

export interface IncidentioEscalationPathsListParams extends IncidentioBaseParams {
  page_size?: number
  after?: string
}

export interface IncidentioEscalationPathsListResponse extends ToolResponse {
  output: {
    escalation_paths: IncidentioEscalationPath[]
    pagination_meta?: {
      after?: string
      page_size: number
    }
  }
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

/**
 * A user as returned on alerting, on-call, catalog, and team payloads, where the API
 * documents `email`, `role`, and `slack_user_id` as optional.
 * @see https://docs.incident.io/api-reference
 */
export interface IncidentioSlimUser {
  id: string
  name: string
  email?: string
  role?: string
  slack_user_id?: string
}

/** Pagination envelope returned by incident.io list endpoints. */
export interface IncidentioPaginationMeta {
  after?: string
  page_size: number
  total_record_count?: number
}

/**
 * A single on-call shift, flattened from a schedule's `current_shifts` or `next_shifts`.
 * @see https://docs.incident.io/api-reference
 */
export interface IncidentioOnCallShift {
  schedule_id: string
  schedule_name: string
  schedule_timezone: string
  schedule_permalink: string | null
  entry_id: string | null
  rotation_id: string | null
  layer_id: string | null
  start_at: string | null
  end_at: string | null
  user_id: string | null
  user_name: string | null
  user_email: string | null
  user_slack_user_id: string | null
}

export interface IncidentioOnCallNowParams extends IncidentioBaseParams {
  schedule_id?: string
  page_size?: number
  after?: string
}

export interface IncidentioOnCallNowResponse extends ToolResponse {
  output: {
    on_call: IncidentioOnCallShift[]
    next_on_call: IncidentioOnCallShift[]
    pagination_meta?: IncidentioPaginationMeta
  }
}

/** A one-off change layered over a schedule's rotations, as the list endpoint returns it. */
export interface IncidentioScheduleOverrideRecord {
  id: string
  schedule_id: string
  rotation_id: string
  layer_id: string
  start_at: string
  end_at: string
  created_at: string
  updated_at: string
  user?: IncidentioSlimUser
}

export interface IncidentioScheduleOverridesListParams extends IncidentioBaseParams {
  schedule_id: string
  rotation_id?: string
  layer_id?: string
  page_size?: number
  after?: string
}

export interface IncidentioScheduleOverridesListResponse extends ToolResponse {
  output: {
    overrides: IncidentioScheduleOverrideRecord[]
    pagination_meta?: IncidentioPaginationMeta
  }
}

/** A single value on an alert attribute, either a literal or a catalog entry reference. */
export interface IncidentioAlertAttributeValue {
  literal?: string
  label?: string
  catalog_entry?: {
    id: string
    name: string
    catalog_type_id: string
  }
}

/** An attribute value parsed from an alert's payload by its alert source config. */
export interface IncidentioAlertAttributeEntry {
  attribute: {
    id: string
    name: string
    type: string
    array: boolean
    required: boolean
    emoji?: string
  }
  value?: IncidentioAlertAttributeValue
  array_value?: IncidentioAlertAttributeValue[]
}

export interface IncidentioAlert {
  id: string
  title: string
  status: string
  alert_source_id: string
  deduplication_key: string
  created_at: string
  updated_at: string
  attributes: IncidentioAlertAttributeEntry[]
  alert_group_ids?: string[]
  description?: string
  resolved_at?: string
  source_url?: string
}

/** The alert shape returned on incident-alert connections, which omits `attributes`. */
export type IncidentioAlertSlim = Omit<IncidentioAlert, 'attributes'>

export interface IncidentioAlertsListParams extends IncidentioBaseParams {
  page_size?: number
  after?: string
  status?: string
  status_operator?: 'one_of' | 'not_in'
  alert_source_id?: string
  alert_source_operator?: 'one_of' | 'not_in'
  deduplication_key?: string
  created_at_gte?: string
  created_at_lte?: string
  has_notes?: boolean
  include_maintenance_window?: boolean
}

export interface IncidentioAlertsListResponse extends ToolResponse {
  output: {
    alerts: IncidentioAlert[]
    pagination_meta?: IncidentioPaginationMeta
  }
}

export interface IncidentioAlertsShowParams extends IncidentioBaseParams {
  id: string
}

export interface IncidentioAlertsShowResponse extends ToolResponse {
  output: {
    alert: IncidentioAlert
  }
}

export interface IncidentioAlertsResolveParams extends IncidentioBaseParams {
  id: string
}

export interface IncidentioAlertsResolveResponse extends ToolResponse {
  output: {
    alert: IncidentioAlert
  }
}

/**
 * Alert events authenticate with the token generated when configuring the HTTP alert source,
 * not with the organisation API key, so these params deliberately do not extend the base params.
 */
export interface IncidentioAlertEventsCreateParams {
  alert_source_config_id: string
  alert_source_token: string
  title: string
  status: 'firing' | 'resolved'
  description?: string
  deduplication_key?: string
  source_url?: string
  metadata?: string
}

export interface IncidentioAlertEventsCreateResponse extends ToolResponse {
  output: {
    deduplication_key: string
    message: string
    status: string
  }
}

/** The connection between an alert and the incident it was attached to. */
export interface IncidentioIncidentAlert {
  id: string
  alert: IncidentioAlertSlim
  incident: {
    id: string
    name: string
    reference: string
    external_id: number
    status_category: string
    visibility: string
    summary?: string
  }
  alert_route_id?: string
}

export interface IncidentioIncidentAlertsListParams extends IncidentioBaseParams {
  page_size?: number
  after?: string
  alert_id?: string
  incident_id?: string
}

export interface IncidentioIncidentAlertsListResponse extends ToolResponse {
  output: {
    incident_alerts: IncidentioIncidentAlert[]
    pagination_meta?: IncidentioPaginationMeta
  }
}

export interface IncidentioEscalationsCancelParams extends IncidentioBaseParams {
  id: string
}

export interface IncidentioEscalationsCancelResponse extends ToolResponse {
  output: {
    message: string
  }
}

/** A catalog type, describing the schema shared by all entries of that type. */
export interface IncidentioCatalogType {
  id: string
  name: string
  description: string
  type_name: string
  engine_resource_type: string
  categories: string[]
  color: string
  icon: string
  ranked: boolean
  is_editable: boolean
  use_name_as_identifier: boolean
  created_at: string
  updated_at: string
  annotations: Record<string, string>
  schema: {
    version: number
    attributes: Array<{
      id: string
      name: string
      type: string
      array: boolean
      mode: string
    }>
  }
  estimated_count?: number
  is_team_type?: boolean
  last_synced_at?: string
  owning_team_ids?: string[]
  registry_type?: string
  required_integrations?: string[]
  source_repo_url?: string
  dynamic_resource_parameter?: string
}

export interface IncidentioCatalogTypesListParams extends IncidentioBaseParams {}

export interface IncidentioCatalogTypesListResponse extends ToolResponse {
  output: {
    catalog_types: IncidentioCatalogType[]
  }
}

/** A single entry of a catalog type, such as one service or one team. */
export interface IncidentioCatalogEntry {
  id: string
  name: string
  catalog_type_id: string
  aliases: string[]
  rank: number
  attribute_values: Record<string, unknown>
  created_at: string
  updated_at: string
  external_id?: string
  archived_at?: string
}

export interface IncidentioCatalogEntriesListParams extends IncidentioBaseParams {
  catalog_type_id: string
  page_size?: number
  after?: string
  identifier?: string
}

export interface IncidentioCatalogEntriesListResponse extends ToolResponse {
  output: {
    catalog_entries: IncidentioCatalogEntry[]
    catalog_type: IncidentioCatalogType | null
    pagination_meta?: IncidentioPaginationMeta
  }
}

export interface IncidentioTeam {
  id: string
  name: string
  members: IncidentioSlimUser[]
  catalog_entry: {
    id: string
    name: string
    external_id?: string
  }
}

export interface IncidentioTeamsListParams extends IncidentioBaseParams {
  page_size?: number
  after?: string
}

export interface IncidentioTeamsListResponse extends ToolResponse {
  output: {
    teams: IncidentioTeam[]
    pagination_meta?: IncidentioPaginationMeta
  }
}

export interface IncidentioTeamsShowParams extends IncidentioBaseParams {
  id: string
}

export interface IncidentioTeamsShowResponse extends ToolResponse {
  output: {
    team: IncidentioTeam
  }
}

/**
 * Output definition for the actor envelope. Unlike a plain user, exactly one of these keys is
 * populated depending on what caused the change.
 */
const INCIDENTIO_ACTOR_OUTPUT_PROPERTIES = {
  user: {
    type: 'object',
    description: 'The user who caused this, if a person did',
    optional: true,
    properties: {
      id: { type: 'string', description: 'User ID' },
      name: { type: 'string', description: 'User display name' },
      email: { type: 'string', description: 'User email address', optional: true },
      role: { type: 'string', description: 'User role', optional: true },
      slack_user_id: { type: 'string', description: 'Slack user ID', optional: true },
    },
  },
  api_key: {
    type: 'object',
    description: 'The API key that caused this, if an integration did',
    optional: true,
    properties: {
      id: { type: 'string', description: 'API key ID' },
      name: { type: 'string', description: 'API key name' },
    },
  },
  workflow: {
    type: 'object',
    description: 'The incident.io workflow that caused this, if automation did',
    optional: true,
    properties: {
      id: { type: 'string', description: 'Workflow ID' },
      name: { type: 'string', description: 'Workflow name' },
    },
  },
  alert: {
    type: 'object',
    description: 'The alert that caused this, if an alert did',
    optional: true,
    properties: {
      id: { type: 'string', description: 'Alert ID' },
      title: { type: 'string', description: 'Alert title' },
    },
  },
} as const satisfies Record<string, OutputProperty>

const INCIDENTIO_EXTERNAL_ISSUE_REFERENCE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'The external issue this was exported to',
  optional: true,
  properties: {
    provider: { type: 'string', description: 'Issue tracker provider' },
    issue_name: { type: 'string', description: 'Human readable issue ID' },
    issue_permalink: { type: 'string', description: 'Link to the issue in the tracker' },
  },
}

const INCIDENTIO_ASSIGNEE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'The assigned user',
  optional: true,
  properties: {
    id: { type: 'string', description: 'User ID' },
    name: { type: 'string', description: 'User display name' },
    email: { type: 'string', description: 'User email address', optional: true },
    role: { type: 'string', description: 'User role', optional: true },
    slack_user_id: { type: 'string', description: 'Slack user ID', optional: true },
  },
}

/**
 * Output definition for a follow-up exactly as the API returns it, including the fields the
 * legacy list/show tools drop.
 */
export const INCIDENTIO_FOLLOW_UP_RECORD_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Follow-up ID' },
  incident_id: { type: 'string', description: 'ID of the incident the follow-up belongs to' },
  title: { type: 'string', description: 'Follow-up title' },
  status: {
    type: 'string',
    description: 'Follow-up status (outstanding, completed, deleted, not_doing)',
  },
  description: { type: 'string', description: 'Follow-up description', optional: true },
  labels: {
    type: 'array',
    description: 'Labels associated with this follow-up',
    items: { type: 'string' },
  },
  assignee: INCIDENTIO_ASSIGNEE_OUTPUT,
  assignee_team: {
    type: 'object',
    description: 'The team the follow-up is assigned to',
    optional: true,
    properties: {
      id: { type: 'string', description: 'Team ID' },
      name: { type: 'string', description: 'Team name' },
    },
  },
  priority: {
    type: 'object',
    description: 'Follow-up priority',
    optional: true,
    properties: {
      id: { type: 'string', description: 'Priority ID' },
      name: { type: 'string', description: 'Priority name' },
      rank: { type: 'number', description: 'Priority rank' },
      description: { type: 'string', description: 'Priority description', optional: true },
    },
  },
  external_issue_reference: INCIDENTIO_EXTERNAL_ISSUE_REFERENCE_OUTPUT,
  creator: {
    type: 'object',
    description: 'Who created the follow-up',
    properties: INCIDENTIO_ACTOR_OUTPUT_PROPERTIES,
  },
  completed_at: {
    type: 'string',
    description: 'When the follow-up was completed',
    optional: true,
  },
  created_at: { type: 'string', description: 'When the follow-up was created' },
  updated_at: { type: 'string', description: 'When the follow-up was last updated' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for an action exactly as the API returns it, including the fields the legacy
 * list/show tools drop.
 */
export const INCIDENTIO_ACTION_RECORD_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Action ID' },
  incident_id: { type: 'string', description: 'ID of the incident the action belongs to' },
  description: { type: 'string', description: 'Action description' },
  status: {
    type: 'string',
    description: 'Action status (outstanding, completed, deleted, not_doing)',
  },
  assignee: INCIDENTIO_ASSIGNEE_OUTPUT,
  external_issue_reference: INCIDENTIO_EXTERNAL_ISSUE_REFERENCE_OUTPUT,
  creator: {
    type: 'object',
    description: 'Who created the action',
    properties: INCIDENTIO_ACTOR_OUTPUT_PROPERTIES,
  },
  completed_at: { type: 'string', description: 'When the action was completed', optional: true },
  created_at: { type: 'string', description: 'When the action was created' },
  updated_at: { type: 'string', description: 'When the action was last updated' },
} as const satisfies Record<string, OutputProperty>

/**
 * Whoever caused something to happen. Exactly one of these is populated, so consumers should
 * check each in turn rather than assuming a user.
 */
export interface IncidentioActor {
  user?: IncidentioSlimUser
  api_key?: { id: string; name: string }
  workflow?: { id: string; name: string }
  alert?: { id: string; title: string }
}

/** A reference to the issue an action or follow-up was exported to. */
export interface IncidentioExternalIssueReference {
  provider: string
  issue_name: string
  issue_permalink: string
}

/** A follow-up exactly as the incident.io API returns it. */
export interface IncidentioFollowUpRecord {
  id: string
  incident_id: string
  title: string
  status: string
  labels: string[]
  creator: IncidentioActor
  created_at: string
  updated_at: string
  description?: string
  completed_at?: string
  assignee?: IncidentioSlimUser
  assignee_team?: { id: string; name: string }
  priority?: {
    id: string
    name: string
    rank: number
    description?: string
  }
  external_issue_reference?: IncidentioExternalIssueReference
}

/** An action exactly as the incident.io API returns it. */
export interface IncidentioActionRecord {
  id: string
  incident_id: string
  description: string
  status: string
  creator: IncidentioActor
  created_at: string
  updated_at: string
  completed_at?: string
  assignee?: IncidentioSlimUser
  external_issue_reference?: IncidentioExternalIssueReference
}

export interface IncidentioFollowUpsCreateParams extends IncidentioBaseParams {
  incident_id: string
  title: string
  description?: string
  assignee_id?: string
  assignee_team_id?: string
  follow_up_category_id?: string
  follow_up_priority_option_id?: string
  external_issue_reference_id?: string
  labels?: string
}

export interface IncidentioFollowUpsCreateResponse extends ToolResponse {
  output: {
    follow_up: IncidentioFollowUpRecord
  }
}

export interface IncidentioFollowUpsUpdateParams extends IncidentioBaseParams {
  id: string
  title: string
  status: 'outstanding' | 'completed' | 'not_doing'
  description?: string
  assignee_id?: string
  assignee_team_id?: string
  follow_up_category_id?: string
  follow_up_priority_option_id?: string
  labels?: string
}

export interface IncidentioFollowUpsUpdateResponse extends ToolResponse {
  output: {
    follow_up: IncidentioFollowUpRecord
  }
}

export interface IncidentioActionsCreateParams extends IncidentioBaseParams {
  incident_id: string
  description: string
  assignee_id?: string
}

export interface IncidentioActionsCreateResponse extends ToolResponse {
  output: {
    action: IncidentioActionRecord
  }
}

export interface IncidentioActionsUpdateParams extends IncidentioBaseParams {
  id: string
  description: string
  status: 'outstanding' | 'completed' | 'not_doing'
  assignee_id?: string
}

export interface IncidentioActionsUpdateResponse extends ToolResponse {
  output: {
    action: IncidentioActionRecord
  }
}

/** A person who took part in an incident, annotated with how they participated. */
export interface IncidentioIncidentParticipant {
  participant_type: string
  user: IncidentioSlimUser
}

export interface IncidentioIncidentParticipantsListParams extends IncidentioBaseParams {
  incident_id: string
}

export interface IncidentioIncidentParticipantsListResponse extends ToolResponse {
  output: {
    active: IncidentioIncidentParticipant[]
    passive: IncidentioIncidentParticipant[]
  }
}

export interface IncidentioIncidentMembershipsCreateParams extends IncidentioBaseParams {
  incident_id: string
  user_id: string
}

export interface IncidentioIncidentMembershipsCreateResponse extends ToolResponse {
  output: {
    incident_membership: {
      id: string
      incident_id: string
      created_at: string
      updated_at: string
      user: IncidentioSlimUser
    }
  }
}

export interface IncidentioIncidentMembershipsRevokeParams extends IncidentioBaseParams {
  incident_id: string
  user_id: string
}

export interface IncidentioIncidentMembershipsRevokeResponse extends ToolResponse {
  output: {
    message: string
  }
}
