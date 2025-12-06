// Common types for incident.io tools
import type { ToolResponse } from '@/tools/types'

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
