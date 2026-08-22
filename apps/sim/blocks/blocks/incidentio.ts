import { IncidentioIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { IncidentioResponse } from '@/tools/incidentio/types'
import { getTrigger } from '@/triggers'

/** Identifiers a user can be looked up by, whichever one is filled. */
const USER_LOOKUP_FIELD = ['user_email', 'user_slack_id'] as const

/** Override target: an id, an email, or a Slack id — exactly one is supplied. */
const OVERRIDE_USER_FIELD = ['user_id', 'user_email', 'user_slack_id'] as const

/** An escalation pages either a path or an explicit user list, never both. */
const ESCALATION_TARGET_FIELD = ['escalation_path_id', 'user_ids'] as const

/**
 * Maps an optional-filter dropdown onto a real boolean, or `undefined` for the "Any" sentinel.
 *
 * The executor merges the transform output over the raw inputs, so a key this returns
 * `undefined` for still overwrites the sentinel string rather than letting it reach the tool.
 * Skipping the assignment instead would leak `has_notes[is]=any` to the API.
 */
function toTriState(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

export const IncidentioBlock: BlockConfig<IncidentioResponse> = {
  type: 'incidentio',
  name: 'incident.io',
  description: 'Manage incidents with incident.io',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate incident.io into the workflow. Manage incidents, actions, follow-ups, workflows, schedules, escalations, custom fields, and more.',
  docsLink: 'https://docs.sim.ai/integrations/incidentio',
  category: 'tools',
  integrationType: IntegrationType.Observability,
  bgColor: '#FFFFFF',
  icon: IncidentioIcon,
  canvasPresentation: {
    defaultTitle: 'incident.io',
    sentences: {
      byOperation: {
        incidentio_incidents_list: ['List incidents'],
        incidentio_incidents_create: [
          { text: 'Create incident', field: 'name', core: true },
          { text: 'at severity', field: 'severity_id', core: true },
        ],
        incidentio_incidents_show: [{ text: 'Fetch incident', field: 'id', core: true }],
        incidentio_incidents_update: [
          { text: 'Update incident', field: 'id', core: true },
          { text: ', to status', field: 'incident_status_id' },
          { text: ', at severity', field: 'severity_id' },
        ],
        incidentio_actions_list: [
          'List actions',
          { text: 'on incident', field: 'incident_id' },
          { text: ', in mode', field: 'incident_mode' },
        ],
        incidentio_actions_show: [{ text: 'Fetch action', field: 'id', core: true }],
        incidentio_follow_ups_list: [
          'List follow-ups',
          { text: 'on incident', field: 'incident_id' },
          { text: ', in mode', field: 'incident_mode' },
        ],
        incidentio_follow_ups_show: [{ text: 'Fetch follow-up', field: 'id', core: true }],
        incidentio_users_list: ['List users', { text: ', matching', field: USER_LOOKUP_FIELD }],
        incidentio_users_show: [{ text: 'Fetch user', field: 'id', core: true }],
        incidentio_workflows_list: ['List workflows'],
        incidentio_workflows_create: [
          { text: 'Create workflow', field: 'name', core: true },
          { text: ', triggered by', field: 'trigger' },
        ],
        incidentio_workflows_show: [{ text: 'Fetch workflow', field: 'id', core: true }],
        incidentio_workflows_update: [
          { text: 'Update workflow', field: 'id', core: true },
          { text: ', renaming to', field: 'name' },
        ],
        incidentio_workflows_delete: [{ text: 'Delete workflow', field: 'id', core: true }],
        incidentio_schedules_list: ['List on-call schedules'],
        incidentio_schedules_create: [
          { text: 'Create schedule', field: 'name', core: true },
          { text: ', in', field: 'timezone' },
        ],
        incidentio_schedules_show: [{ text: 'Fetch schedule', field: 'id', core: true }],
        incidentio_schedules_update: [
          { text: 'Update schedule', field: 'id', core: true },
          { text: ', renaming to', field: 'name' },
        ],
        incidentio_schedules_delete: [{ text: 'Delete schedule', field: 'id', core: true }],
        incidentio_escalations_list: ['List escalations'],
        incidentio_escalations_create: [
          { text: 'Raise escalation', field: 'title', core: true },
          { text: ', to', field: ESCALATION_TARGET_FIELD },
        ],
        incidentio_escalations_show: [{ text: 'Fetch escalation', field: 'id', core: true }],
        incidentio_custom_fields_list: ['List custom fields'],
        incidentio_custom_fields_create: [
          { text: 'Create custom field', field: 'name', core: true },
          { text: ', of type', field: 'field_type' },
        ],
        incidentio_custom_fields_show: [{ text: 'Fetch custom field', field: 'id', core: true }],
        incidentio_custom_fields_update: [
          { text: 'Update custom field', field: 'id', core: true },
          { text: ', renaming to', field: 'name' },
        ],
        incidentio_custom_fields_delete: [{ text: 'Delete custom field', field: 'id', core: true }],
        incidentio_severities_list: ['List severity levels'],
        incidentio_incident_statuses_list: ['List incident statuses'],
        incidentio_incident_types_list: ['List incident types'],
        incidentio_incident_roles_list: ['List incident roles'],
        incidentio_incident_roles_create: [
          { text: 'Create incident role', field: 'name', core: true },
          { text: ', with shortform', field: 'shortform' },
        ],
        incidentio_incident_roles_show: [{ text: 'Fetch incident role', field: 'id', core: true }],
        incidentio_incident_roles_update: [
          { text: 'Update incident role', field: 'id', core: true },
          { text: ', renaming to', field: 'name' },
        ],
        incidentio_incident_roles_delete: [
          { text: 'Delete incident role', field: 'id', core: true },
        ],
        incidentio_incident_timestamps_list: ['List incident timestamps'],
        incidentio_incident_timestamps_show: [
          { text: 'Fetch incident timestamp', field: 'id', core: true },
        ],
        incidentio_incident_updates_list: [
          'List status updates',
          { text: 'on incident', field: 'incident_id' },
        ],
        incidentio_schedule_entries_list: [
          { text: 'List entries on schedule', field: 'schedule_id', core: true },
          { text: ', from', field: 'entry_window_start' },
          { text: ', through', field: 'entry_window_end' },
        ],
        incidentio_schedule_overrides_create: [
          { text: 'Override schedule', field: 'schedule_id', core: true },
          { text: ', assigning', field: OVERRIDE_USER_FIELD },
          { text: ', from', field: 'start_at' },
        ],
        incidentio_escalation_paths_list: ['List escalation paths'],
        incidentio_escalation_paths_create: [
          { text: 'Create escalation path', field: 'name', core: true },
        ],
        incidentio_escalation_paths_show: [
          { text: 'Fetch escalation path', field: 'id', core: true },
        ],
        incidentio_escalation_paths_update: [
          { text: 'Update escalation path', field: 'id', core: true },
          { text: ', renaming to', field: 'name' },
        ],
        incidentio_escalation_paths_delete: [
          { text: 'Delete escalation path', field: 'id', core: true },
        ],
        incidentio_on_call_now: [
          'Get who is on call',
          { text: 'on schedule', field: 'schedule_id' },
        ],
        incidentio_schedule_overrides_list: [
          { text: 'List overrides on schedule', field: 'schedule_id', core: true },
        ],
        incidentio_alerts_list: [
          'List alerts',
          { text: ', with status', field: 'alert_status' },
          { text: ', from source', field: 'alert_source_id' },
        ],
        incidentio_alerts_show: [{ text: 'Fetch alert', field: 'id', core: true }],
        incidentio_alerts_resolve: [{ text: 'Resolve alert', field: 'id', core: true }],
        incidentio_alert_events_create: [
          { text: 'Fire alert', field: 'alert_title', core: true },
          { text: ', into source', field: 'alert_source_config_id' },
        ],
        incidentio_incident_alerts_list: [
          'List incident alerts',
          { text: ', on incident', field: 'incident_id' },
          { text: ', for alert', field: 'alert_id' },
        ],
        incidentio_escalations_cancel: [{ text: 'Cancel escalation', field: 'id', core: true }],
        incidentio_catalog_types_list: ['List catalog types'],
        incidentio_catalog_entries_list: [
          { text: 'List entries of catalog type', field: 'catalog_type_id', core: true },
        ],
        incidentio_teams_list: ['List teams'],
        incidentio_teams_show: [{ text: 'Fetch team', field: 'id', core: true }],
        incidentio_follow_ups_create: [
          { text: 'Create follow-up', field: 'follow_up_title', core: true },
          { text: ', on incident', field: 'incident_id' },
        ],
        incidentio_follow_ups_update: [
          { text: 'Update follow-up', field: 'id', core: true },
          { text: ', to status', field: 'item_status' },
        ],
        incidentio_actions_create: [
          { text: 'Create action', field: 'action_description', core: true },
          { text: ', on incident', field: 'incident_id' },
        ],
        incidentio_actions_update: [
          { text: 'Update action', field: 'id', core: true },
          { text: ', to status', field: 'item_status' },
        ],
        incidentio_incident_participants_list: [
          { text: 'List participants of incident', field: 'incident_id', core: true },
        ],
        incidentio_incident_memberships_create: [
          { text: 'Grant', field: 'user_id', core: true },
          { text: 'access to incident', field: 'incident_id', core: true },
        ],
        incidentio_incident_memberships_revoke: [
          { text: 'Revoke', field: 'user_id', core: true },
          { text: 'access to incident', field: 'incident_id', core: true },
        ],
      },
    },
  },
  triggers: {
    enabled: true,
    available: [
      'incidentio_incident_created',
      'incidentio_incident_updated',
      'incidentio_incident_status_updated',
      'incidentio_alert_created',
    ],
  },
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
        { label: 'List Escalation Paths', id: 'incidentio_escalation_paths_list' },
        { label: 'Create Escalation Path', id: 'incidentio_escalation_paths_create' },
        { label: 'Show Escalation Path', id: 'incidentio_escalation_paths_show' },
        { label: 'Update Escalation Path', id: 'incidentio_escalation_paths_update' },
        { label: 'Delete Escalation Path', id: 'incidentio_escalation_paths_delete' },
        // On-call
        { label: 'Get Who Is On Call', id: 'incidentio_on_call_now' },
        { label: 'List Schedule Overrides', id: 'incidentio_schedule_overrides_list' },
        // Alerts
        { label: 'List Alerts', id: 'incidentio_alerts_list' },
        { label: 'Show Alert', id: 'incidentio_alerts_show' },
        { label: 'Resolve Alert', id: 'incidentio_alerts_resolve' },
        { label: 'Create Alert Event', id: 'incidentio_alert_events_create' },
        { label: 'List Incident Alerts', id: 'incidentio_incident_alerts_list' },
        // Escalations
        { label: 'Cancel Escalation', id: 'incidentio_escalations_cancel' },
        // Catalog
        { label: 'List Catalog Types', id: 'incidentio_catalog_types_list' },
        { label: 'List Catalog Entries', id: 'incidentio_catalog_entries_list' },
        // Teams
        { label: 'List Teams', id: 'incidentio_teams_list' },
        { label: 'Show Team', id: 'incidentio_teams_show' },
        // Follow-ups
        { label: 'Create Follow-up', id: 'incidentio_follow_ups_create' },
        { label: 'Update Follow-up', id: 'incidentio_follow_ups_update' },
        // Actions
        { label: 'Create Action', id: 'incidentio_actions_create' },
        { label: 'Update Action', id: 'incidentio_actions_update' },
        // Incident people
        { label: 'List Incident Participants', id: 'incidentio_incident_participants_list' },
        { label: 'Grant Incident Membership', id: 'incidentio_incident_memberships_create' },
        { label: 'Revoke Incident Membership', id: 'incidentio_incident_memberships_revoke' },
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
          'incidentio_users_list',
          'incidentio_schedules_list',
          'incidentio_escalations_list',
          'incidentio_incident_updates_list',
          'incidentio_escalation_paths_list',
          'incidentio_on_call_now',
          'incidentio_schedule_overrides_list',
          'incidentio_alerts_list',
          'incidentio_incident_alerts_list',
          'incidentio_catalog_entries_list',
          'incidentio_teams_list',
        ],
      },
      mode: 'advanced',
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
          'incidentio_users_list',
          'incidentio_schedules_list',
          'incidentio_escalations_list',
          'incidentio_incident_updates_list',
          'incidentio_escalation_paths_list',
          'incidentio_on_call_now',
          'incidentio_schedule_overrides_list',
          'incidentio_alerts_list',
          'incidentio_incident_alerts_list',
          'incidentio_catalog_entries_list',
          'incidentio_teams_list',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'sort_by',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'Created At: Newest First', id: 'created_at_newest_first' },
        { label: 'Created At: Oldest First', id: 'created_at_oldest_first' },
      ],
      value: () => 'created_at_newest_first',
      condition: { field: 'operation', value: 'incidentio_incidents_list' },
      mode: 'advanced',
    },
    {
      id: 'filter_mode',
      title: 'Filter Mode',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Any', id: 'any' },
      ],
      value: () => 'all',
      condition: { field: 'operation', value: 'incidentio_incidents_list' },
      mode: 'advanced',
    },
    // Incidents Create operation inputs
    {
      id: 'summary',
      title: 'Summary',
      type: 'long-input',
      placeholder: 'Enter incident summary...',
      condition: {
        field: 'operation',
        value: ['incidentio_incidents_create', 'incidentio_incidents_update'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an incident summary based on the user's description.
The summary should:
- Clearly describe the impact and scope of the incident
- Include relevant technical details
- Be professional and suitable for stakeholder communication

Return ONLY the summary text - no explanations.`,
        placeholder: 'Describe the incident details (e.g., "users unable to login since 2pm")...',
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
      required: { field: 'operation', value: 'incidentio_incidents_create' },
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
          'incidentio_alerts_show',
          'incidentio_alerts_resolve',
          'incidentio_escalations_cancel',
          'incidentio_teams_show',
          'incidentio_follow_ups_update',
          'incidentio_actions_update',
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
          'incidentio_incidents_create',
          'incidentio_incidents_update',
          'incidentio_workflows_create',
          'incidentio_workflows_update',
          'incidentio_schedules_create',
          'incidentio_schedules_update',
          'incidentio_custom_fields_create',
          'incidentio_custom_fields_update',
          'incidentio_incident_roles_create',
          'incidentio_incident_roles_update',
          'incidentio_escalation_paths_create',
          'incidentio_escalation_paths_update',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'incidentio_workflows_create',
          'incidentio_workflows_update',
          'incidentio_schedules_create',
          'incidentio_custom_fields_create',
          'incidentio_incident_roles_create',
          'incidentio_incident_roles_update',
          'incidentio_escalation_paths_create',
          'incidentio_escalation_paths_update',
        ],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a concise resource name based on the user's description.
The name should:
- Be clear and descriptive
- Indicate the resource purpose
- Be suitable for incident.io records

Return ONLY the name - no explanations.`,
        placeholder: 'Describe the name you want to use...',
      },
    },
    // Escalations inputs
    {
      id: 'idempotency_key',
      title: 'Idempotency Key',
      type: 'short-input',
      placeholder: 'Enter unique key (e.g., UUID)...',
      condition: {
        field: 'operation',
        value: ['incidentio_incidents_create', 'incidentio_escalations_create'],
      },
      required: {
        field: 'operation',
        value: ['incidentio_incidents_create', 'incidentio_escalations_create'],
      },
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Enter escalation title...',
      condition: { field: 'operation', value: 'incidentio_escalations_create' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate an escalation title based on the user's description.
The title should:
- Be concise and urgent
- Clearly indicate the escalation reason
- Be suitable for paging and alerting

Return ONLY the title - no explanations.`,
        placeholder:
          'Describe the escalation reason (e.g., "critical system down", "security breach detected")...',
      },
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
    // Actions List inputs
    {
      id: 'incident_id',
      title: 'Incident ID',
      type: 'short-input',
      placeholder: 'Enter incident ID...',
      condition: {
        field: 'operation',
        value: [
          'incidentio_actions_list',
          'incidentio_follow_ups_list',
          'incidentio_incident_updates_list',
          'incidentio_incident_alerts_list',
          'incidentio_incident_participants_list',
          'incidentio_incident_memberships_create',
          'incidentio_incident_memberships_revoke',
          'incidentio_follow_ups_create',
          'incidentio_actions_create',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'incidentio_incident_participants_list',
          'incidentio_incident_memberships_create',
          'incidentio_incident_memberships_revoke',
          'incidentio_follow_ups_create',
          'incidentio_actions_create',
        ],
      },
    },
    {
      id: 'incident_mode',
      title: 'Incident Mode',
      type: 'dropdown',
      options: [
        { label: 'Standard', id: 'standard' },
        { label: 'Retrospective', id: 'retrospective' },
        { label: 'Test', id: 'test' },
        { label: 'Tutorial', id: 'tutorial' },
        { label: 'Stream', id: 'stream' },
      ],
      condition: {
        field: 'operation',
        value: ['incidentio_actions_list', 'incidentio_follow_ups_list'],
      },
      mode: 'advanced',
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
      id: 'skip_step_upgrades',
      title: 'Skip Step Upgrades',
      type: 'switch',
      value: () => 'false',
      condition: { field: 'operation', value: 'incidentio_workflows_show' },
      mode: 'advanced',
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
    {
      id: 'trigger',
      title: 'Trigger',
      type: 'short-input',
      placeholder: 'incident.updated',
      condition: { field: 'operation', value: 'incidentio_workflows_create' },
      mode: 'advanced',
    },
    {
      id: 'runs_on_incidents',
      title: 'Runs On Incidents',
      type: 'dropdown',
      options: [
        { label: 'Newly Created', id: 'newly_created' },
        { label: 'Newly Created and Active', id: 'newly_created_and_active' },
        { label: 'Active', id: 'active' },
        { label: 'All', id: 'all' },
      ],
      value: () => 'newly_created',
      condition: {
        field: 'operation',
        value: ['incidentio_workflows_create', 'incidentio_workflows_update'],
      },
      mode: 'advanced',
      required: { field: 'operation', value: 'incidentio_workflows_update' },
    },
    {
      id: 'runs_on_incident_modes',
      title: 'Incident Modes',
      type: 'short-input',
      placeholder: '["standard"]',
      condition: {
        field: 'operation',
        value: ['incidentio_workflows_create', 'incidentio_workflows_update'],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of incident.io incident modes, such as ["standard"] or ["standard","retrospective"]. Return ONLY the JSON array - no explanations, no extra text.',
        placeholder: 'Describe which incident modes should run the workflow...',
        generationType: 'json-object',
      },
    },
    {
      id: 'steps',
      title: 'Steps',
      type: 'long-input',
      placeholder: '[{"label":"Notify team","name":"slack.post_message"}]',
      condition: {
        field: 'operation',
        value: ['incidentio_workflows_create', 'incidentio_workflows_update'],
      },
      mode: 'advanced',
      required: { field: 'operation', value: 'incidentio_workflows_update' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of incident.io workflow steps. Return ONLY the JSON array - no explanations, no extra text.',
        placeholder: 'Describe the workflow steps...',
        generationType: 'json-object',
      },
    },
    {
      id: 'condition_groups',
      title: 'Condition Groups',
      type: 'long-input',
      placeholder: '[]',
      condition: {
        field: 'operation',
        value: ['incidentio_workflows_create', 'incidentio_workflows_update'],
      },
      mode: 'advanced',
      required: { field: 'operation', value: 'incidentio_workflows_update' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of incident.io workflow condition groups. Return ONLY the JSON array - no explanations, no extra text.',
        placeholder: 'Describe the workflow conditions...',
        generationType: 'json-object',
      },
    },
    {
      id: 'expressions',
      title: 'Expressions',
      type: 'long-input',
      placeholder: '[]',
      condition: {
        field: 'operation',
        value: ['incidentio_workflows_create', 'incidentio_workflows_update'],
      },
      mode: 'advanced',
      required: { field: 'operation', value: 'incidentio_workflows_update' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of incident.io workflow expressions. Return ONLY the JSON array - no explanations, no extra text.',
        placeholder: 'Describe any workflow expressions...',
        generationType: 'json-object',
      },
    },
    {
      id: 'once_for',
      title: 'Once For',
      type: 'short-input',
      placeholder: '[]',
      condition: {
        field: 'operation',
        value: ['incidentio_workflows_create', 'incidentio_workflows_update'],
      },
      mode: 'advanced',
      required: { field: 'operation', value: 'incidentio_workflows_update' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of fields that should make an incident.io workflow run only once for each unique combination. Return ONLY the JSON array - no explanations, no extra text.',
        placeholder: 'Describe what should make the workflow run once...',
        generationType: 'json-object',
      },
    },
    {
      id: 'delay',
      title: 'Delay',
      type: 'long-input',
      placeholder: '{"for_seconds":60,"conditions_apply_over_delay":false}',
      condition: {
        field: 'operation',
        value: ['incidentio_workflows_create', 'incidentio_workflows_update'],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object for an incident.io workflow delay. Return ONLY the JSON object - no explanations, no extra text.',
        placeholder: 'Describe the workflow delay...',
        generationType: 'json-object',
      },
    },
    {
      id: 'include_private_incidents',
      title: 'Include Private Incidents',
      type: 'switch',
      value: () => 'true',
      condition: {
        field: 'operation',
        value: ['incidentio_workflows_create', 'incidentio_workflows_update'],
      },
      mode: 'advanced',
      required: { field: 'operation', value: 'incidentio_workflows_update' },
    },
    {
      id: 'continue_on_step_error',
      title: 'Continue On Step Error',
      type: 'switch',
      value: () => 'false',
      condition: {
        field: 'operation',
        value: ['incidentio_workflows_create', 'incidentio_workflows_update'],
      },
      mode: 'advanced',
      required: { field: 'operation', value: 'incidentio_workflows_update' },
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
      condition: {
        field: 'operation',
        value: ['incidentio_schedules_create', 'incidentio_schedules_update'],
      },
      required: { field: 'operation', value: 'incidentio_schedules_create' },
    },
    {
      id: 'config',
      title: 'Schedule Configuration',
      type: 'long-input',
      placeholder:
        'JSON configuration with rotations. Example: {"rotations": [{"name": "Primary", "users": [{"id": "user_id"}], "handover_start_at": "2024-01-01T09:00:00Z", "handovers": [{"interval": 1, "interval_type": "weekly"}]}]}',
      condition: { field: 'operation', value: 'incidentio_schedules_create' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON schedule configuration for incident.io based on the user's description.
The configuration must follow this structure:
{
  "rotations": [
    {
      "name": "Rotation Name",
      "users": [{"id": "user_id"}],
      "handover_start_at": "ISO8601 timestamp",
      "handovers": [{"interval": number, "interval_type": "daily|weekly|monthly"}]
    }
  ]
}

Return ONLY the JSON object - no explanations or markdown formatting.`,
        placeholder:
          'Describe the schedule (e.g., "weekly rotation between 3 engineers starting Monday 9am")...',
        generationType: 'json-object',
      },
    },
    // Custom Fields inputs
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Enter description...',
      condition: {
        field: 'operation',
        value: [
          'incidentio_custom_fields_create',
          'incidentio_custom_fields_update',
          'incidentio_incident_roles_create',
          'incidentio_incident_roles_update',
        ],
      },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a description for a custom field based on the user's description.
The description should:
- Explain what the field is used for
- Provide guidance on how to fill it out
- Be clear and concise

Return ONLY the description text - no explanations.`,
        placeholder:
          'Describe the custom field purpose (e.g., "tracks affected customer count", "categorizes incident type")...',
      },
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
      id: 'instructions',
      title: 'Instructions',
      type: 'long-input',
      placeholder: 'Enter instructions for the role...',
      condition: {
        field: 'operation',
        value: ['incidentio_incident_roles_create', 'incidentio_incident_roles_update'],
      },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate instructions for an incident role based on the user's description.
The instructions should:
- Provide step-by-step guidance for the role
- Include key actions and responsibilities
- Be actionable and clear during an incident

Return ONLY the instructions text - no explanations.`,
        placeholder:
          'Describe what the role should do (e.g., "manage external communications during outages")...',
      },
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
    // Schedule Entries inputs
    {
      id: 'schedule_id',
      title: 'Schedule ID',
      type: 'short-input',
      placeholder: 'Enter schedule ID...',
      condition: {
        field: 'operation',
        value: [
          'incidentio_schedule_entries_list',
          'incidentio_schedule_overrides_create',
          'incidentio_schedule_overrides_list',
          'incidentio_on_call_now',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'incidentio_schedule_entries_list',
          'incidentio_schedule_overrides_create',
          'incidentio_schedule_overrides_list',
        ],
      },
    },
    {
      id: 'entry_window_start',
      title: 'Entry Window Start (Date/Time)',
      type: 'short-input',
      placeholder: 'ISO 8601 format (e.g., 2024-01-01T00:00:00Z)...',
      condition: { field: 'operation', value: 'incidentio_schedule_entries_list' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "beginning of this week" -> Monday of current week at 00:00:00Z
- "last month" -> First day of previous month at 00:00:00Z
- "yesterday" -> Yesterday's date at 00:00:00Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start date (e.g., "beginning of this week", "last month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'entry_window_end',
      title: 'Entry Window End (Date/Time)',
      type: 'short-input',
      placeholder: 'ISO 8601 format (e.g., 2024-12-31T23:59:59Z)...',
      condition: { field: 'operation', value: 'incidentio_schedule_entries_list' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "end of this week" -> Sunday of current week at 23:59:59Z
- "end of next month" -> Last day of next month at 23:59:59Z
- "tomorrow" -> Tomorrow's date at 23:59:59Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end date (e.g., "end of this week", "end of next month")...',
        generationType: 'timestamp',
      },
    },
    // Schedule Overrides inputs
    {
      id: 'rotation_id',
      title: 'Rotation ID',
      type: 'short-input',
      placeholder: 'Enter rotation ID...',
      condition: {
        field: 'operation',
        value: ['incidentio_schedule_overrides_create', 'incidentio_schedule_overrides_list'],
      },
      required: { field: 'operation', value: 'incidentio_schedule_overrides_create' },
    },
    {
      id: 'layer_id',
      title: 'Layer ID',
      type: 'short-input',
      placeholder: 'Enter layer ID...',
      condition: {
        field: 'operation',
        value: ['incidentio_schedule_overrides_create', 'incidentio_schedule_overrides_list'],
      },
      required: { field: 'operation', value: 'incidentio_schedule_overrides_create' },
    },
    {
      id: 'user_id',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Enter user ID...',
      condition: {
        field: 'operation',
        value: [
          'incidentio_schedule_overrides_create',
          'incidentio_incident_memberships_create',
          'incidentio_incident_memberships_revoke',
        ],
      },
      required: {
        field: 'operation',
        value: ['incidentio_incident_memberships_create', 'incidentio_incident_memberships_revoke'],
      },
    },
    {
      id: 'user_email',
      title: 'User Email',
      type: 'short-input',
      placeholder: 'Enter user email...',
      condition: {
        field: 'operation',
        value: ['incidentio_schedule_overrides_create', 'incidentio_users_list'],
      },
      required: false,
    },
    {
      id: 'user_slack_id',
      title: 'User Slack ID',
      type: 'short-input',
      placeholder: 'Enter user Slack ID...',
      condition: {
        field: 'operation',
        value: ['incidentio_schedule_overrides_create', 'incidentio_users_list'],
      },
      required: false,
    },
    {
      id: 'start_at',
      title: 'Start At',
      type: 'short-input',
      placeholder: 'ISO 8601 format (e.g., 2024-01-01T00:00:00Z)...',
      condition: { field: 'operation', value: 'incidentio_schedule_overrides_create' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "now" -> Current date and time in UTC
- "tomorrow at 9am" -> Tomorrow at 09:00:00Z
- "next Monday" -> Next Monday at 00:00:00Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start time (e.g., "now", "tomorrow at 9am")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'end_at',
      title: 'End At',
      type: 'short-input',
      placeholder: 'ISO 8601 format (e.g., 2024-12-31T23:59:59Z)...',
      condition: { field: 'operation', value: 'incidentio_schedule_overrides_create' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "in 4 hours" -> Current time plus 4 hours
- "tomorrow at 5pm" -> Tomorrow at 17:00:00Z
- "end of next week" -> Next Sunday at 23:59:59Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end time (e.g., "in 4 hours", "tomorrow at 5pm")...',
        generationType: 'timestamp',
      },
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
        value: ['incidentio_escalation_paths_create', 'incidentio_escalation_paths_update'],
      },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array for escalation path configuration based on the user's description.
The array must follow this structure:
[
  {
    "targets": [{"id": "target_id", "type": "user|schedule", "urgency": "high|low"}],
    "time_to_ack_seconds": number
  }
]

Each level represents an escalation step with acknowledgment timeout.

Return ONLY the JSON array - no explanations or markdown formatting.`,
        placeholder:
          'Describe the escalation path (e.g., "page on-call first, then manager after 5 min")...',
        generationType: 'json-object',
      },
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
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array for working hours configuration based on the user's description.
The array must follow this structure:
[
  {"weekday": "monday|tuesday|wednesday|thursday|friday|saturday|sunday", "start_time": "HH:MM", "end_time": "HH:MM"}
]

Return ONLY the JSON array - no explanations or markdown formatting.`,
        placeholder: 'Describe working hours (e.g., "9-5 Monday to Friday", "24/7 coverage")...',
        generationType: 'json-object',
      },
    },
    // Alerts inputs
    {
      id: 'alert_status',
      title: 'Alert Status',
      type: 'dropdown',
      options: [
        { label: 'Firing', id: 'firing' },
        { label: 'Resolved', id: 'resolved' },
      ],
      condition: {
        field: 'operation',
        value: ['incidentio_alerts_list', 'incidentio_alert_events_create'],
      },
      required: { field: 'operation', value: 'incidentio_alert_events_create' },
    },
    {
      id: 'status_operator',
      title: 'Alert Status Match',
      type: 'dropdown',
      options: [
        { label: 'Is One Of', id: 'one_of' },
        { label: 'Is Not', id: 'not_in' },
      ],
      value: () => 'one_of',
      condition: { field: 'operation', value: 'incidentio_alerts_list' },
      mode: 'advanced',
    },
    {
      id: 'alert_source_id',
      title: 'Alert Source ID',
      type: 'short-input',
      placeholder: 'Filter by alert source ID...',
      condition: { field: 'operation', value: 'incidentio_alerts_list' },
      mode: 'advanced',
    },
    {
      id: 'alert_source_operator',
      title: 'Alert Source Match',
      type: 'dropdown',
      options: [
        { label: 'Is One Of', id: 'one_of' },
        { label: 'Is Not', id: 'not_in' },
      ],
      value: () => 'one_of',
      condition: { field: 'operation', value: 'incidentio_alerts_list' },
      mode: 'advanced',
    },
    {
      id: 'deduplication_key',
      title: 'Deduplication Key',
      type: 'short-input',
      placeholder: 'Reuse this key to update or resolve the same alert...',
      condition: {
        field: 'operation',
        value: ['incidentio_alerts_list', 'incidentio_alert_events_create'],
      },
    },
    {
      id: 'created_at_gte',
      title: 'Created On Or After',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD (e.g., 2025-01-01)...',
      condition: { field: 'operation', value: 'incidentio_alerts_list' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a date based on the user's description.
The date should be in the format: YYYY-MM-DD.

Return ONLY the date string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the earliest date (e.g., "start of last month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'created_at_lte',
      title: 'Created On Or Before',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD (e.g., 2025-02-01)...',
      condition: { field: 'operation', value: 'incidentio_alerts_list' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a date based on the user's description.
The date should be in the format: YYYY-MM-DD.

Return ONLY the date string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the latest date (e.g., "end of last month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'has_notes',
      title: 'Has Notes',
      type: 'dropdown',
      options: [
        { label: 'Any', id: 'any' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'any',
      condition: { field: 'operation', value: 'incidentio_alerts_list' },
      mode: 'advanced',
    },
    {
      id: 'include_maintenance_window',
      title: 'Include Maintenance Window Alerts',
      type: 'dropdown',
      options: [
        { label: 'Any', id: 'any' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'any',
      condition: { field: 'operation', value: 'incidentio_alerts_list' },
      mode: 'advanced',
    },
    {
      id: 'alert_id',
      title: 'Alert ID',
      type: 'short-input',
      placeholder: 'Filter by alert ID...',
      condition: { field: 'operation', value: 'incidentio_incident_alerts_list' },
    },
    {
      id: 'alert_source_config_id',
      title: 'Alert Source Config ID',
      type: 'short-input',
      placeholder: 'Enter HTTP alert source config ID...',
      condition: { field: 'operation', value: 'incidentio_alert_events_create' },
      required: true,
    },
    {
      id: 'alert_source_token',
      title: 'Alert Source Token',
      type: 'short-input',
      placeholder: 'Enter the token from the HTTP alert source setup...',
      password: true,
      condition: { field: 'operation', value: 'incidentio_alert_events_create' },
      required: true,
    },
    {
      id: 'alert_title',
      title: 'Alert Title',
      type: 'short-input',
      placeholder: 'Enter alert title...',
      condition: { field: 'operation', value: 'incidentio_alert_events_create' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate an alert title based on the user's description.
The title should:
- Name the affected system and the symptom
- Be short enough to read in a page notification

Return ONLY the title - no explanations.`,
        placeholder: 'Describe the alert (e.g., "checkout latency above 2s")...',
      },
    },
    {
      id: 'alert_description',
      title: 'Alert Description',
      type: 'long-input',
      placeholder: 'Enter alert description (supports Markdown)...',
      condition: { field: 'operation', value: 'incidentio_alert_events_create' },
    },
    {
      id: 'source_url',
      title: 'Source URL',
      type: 'short-input',
      placeholder: 'Link back to the alert in the upstream system...',
      condition: { field: 'operation', value: 'incidentio_alert_events_create' },
      mode: 'advanced',
    },
    {
      id: 'metadata',
      title: 'Metadata',
      type: 'long-input',
      placeholder: '{"service": "payments"}',
      condition: { field: 'operation', value: 'incidentio_alert_events_create' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object of alert metadata based on the user's description.

Return ONLY the JSON object - no explanations, no markdown fences.`,
        placeholder:
          'Describe the metadata to attach (e.g., "service payments, region eu-west-1")...',
        generationType: 'json-object',
      },
    },
    // Catalog inputs
    {
      id: 'catalog_type_id',
      title: 'Catalog Type ID',
      type: 'short-input',
      placeholder: 'Enter catalog type ID...',
      condition: { field: 'operation', value: 'incidentio_catalog_entries_list' },
      required: true,
    },
    {
      id: 'identifier',
      title: 'Identifier',
      type: 'short-input',
      placeholder: 'Match entries by ID, external ID, or alias...',
      condition: { field: 'operation', value: 'incidentio_catalog_entries_list' },
      mode: 'advanced',
    },
    // Follow-up and Action inputs
    {
      id: 'follow_up_title',
      title: 'Follow-up Title',
      type: 'short-input',
      placeholder: 'Enter follow-up title...',
      condition: {
        field: 'operation',
        value: ['incidentio_follow_ups_create', 'incidentio_follow_ups_update'],
      },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a follow-up title based on the user's description.
The title should:
- Name the concrete piece of work to be done after the incident
- Start with a verb

Return ONLY the title - no explanations.`,
        placeholder:
          'Describe the follow-up (e.g., "add alerting on connection pool saturation")...',
      },
    },
    {
      id: 'follow_up_description',
      title: 'Follow-up Description',
      type: 'long-input',
      placeholder: 'Enter follow-up description (supports Markdown)...',
      condition: {
        field: 'operation',
        value: ['incidentio_follow_ups_create', 'incidentio_follow_ups_update'],
      },
    },
    {
      id: 'action_description',
      title: 'Action Description',
      type: 'long-input',
      placeholder: 'Enter action description (supports Markdown)...',
      condition: {
        field: 'operation',
        value: ['incidentio_actions_create', 'incidentio_actions_update'],
      },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate an incident action description based on the user's description.
The description should:
- Name the concrete step someone needs to take during the incident
- Start with a verb

Return ONLY the description - no explanations.`,
        placeholder: 'Describe the action (e.g., "fail over the primary database")...',
      },
    },
    {
      id: 'item_status',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'Outstanding', id: 'outstanding' },
        { label: 'Completed', id: 'completed' },
        { label: 'Not Doing', id: 'not_doing' },
      ],
      value: () => 'outstanding',
      condition: {
        field: 'operation',
        value: ['incidentio_follow_ups_update', 'incidentio_actions_update'],
      },
      required: true,
    },
    {
      id: 'assignee_id',
      title: 'Assignee ID',
      type: 'short-input',
      placeholder: 'Enter user ID to assign to...',
      condition: {
        field: 'operation',
        value: [
          'incidentio_follow_ups_create',
          'incidentio_follow_ups_update',
          'incidentio_actions_create',
          'incidentio_actions_update',
        ],
      },
    },
    {
      id: 'assignee_team_id',
      title: 'Assignee Team ID',
      type: 'short-input',
      placeholder: 'Enter team ID to assign to...',
      condition: {
        field: 'operation',
        value: ['incidentio_follow_ups_create', 'incidentio_follow_ups_update'],
      },
      mode: 'advanced',
    },
    {
      id: 'follow_up_category_id',
      title: 'Follow-up Category ID',
      type: 'short-input',
      placeholder: 'Enter follow-up category ID...',
      condition: {
        field: 'operation',
        value: ['incidentio_follow_ups_create', 'incidentio_follow_ups_update'],
      },
      mode: 'advanced',
    },
    {
      id: 'follow_up_priority_option_id',
      title: 'Follow-up Priority ID',
      type: 'short-input',
      placeholder: 'Enter follow-up priority option ID...',
      condition: {
        field: 'operation',
        value: ['incidentio_follow_ups_create', 'incidentio_follow_ups_update'],
      },
      mode: 'advanced',
    },
    {
      id: 'external_issue_reference_id',
      title: 'External Issue Reference ID',
      type: 'short-input',
      placeholder: 'Enter external issue ID...',
      condition: { field: 'operation', value: 'incidentio_follow_ups_create' },
      mode: 'advanced',
    },
    {
      id: 'labels',
      title: 'Labels',
      type: 'short-input',
      placeholder: 'Comma-separated labels (e.g., bug,urgent)...',
      condition: {
        field: 'operation',
        value: ['incidentio_follow_ups_create', 'incidentio_follow_ups_update'],
      },
      mode: 'advanced',
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
    // Trigger subBlocks (webhook configuration)
    ...getTrigger('incidentio_incident_created').subBlocks,
    ...getTrigger('incidentio_incident_updated').subBlocks,
    ...getTrigger('incidentio_incident_status_updated').subBlocks,
    ...getTrigger('incidentio_alert_created').subBlocks,
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
      'incidentio_escalation_paths_list',
      'incidentio_escalation_paths_create',
      'incidentio_escalation_paths_show',
      'incidentio_escalation_paths_update',
      'incidentio_escalation_paths_delete',
      'incidentio_on_call_now',
      'incidentio_schedule_overrides_list',
      'incidentio_alerts_list',
      'incidentio_alerts_show',
      'incidentio_alerts_resolve',
      'incidentio_alert_events_create',
      'incidentio_incident_alerts_list',
      'incidentio_escalations_cancel',
      'incidentio_catalog_types_list',
      'incidentio_catalog_entries_list',
      'incidentio_teams_list',
      'incidentio_teams_show',
      'incidentio_follow_ups_create',
      'incidentio_follow_ups_update',
      'incidentio_actions_create',
      'incidentio_actions_update',
      'incidentio_incident_participants_list',
      'incidentio_incident_memberships_create',
      'incidentio_incident_memberships_revoke',
    ],
    config: {
      tool: (params) => {
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
          case 'incidentio_escalation_paths_list':
            return 'incidentio_escalation_paths_list'
          case 'incidentio_escalation_paths_create':
            return 'incidentio_escalation_paths_create'
          case 'incidentio_escalation_paths_show':
            return 'incidentio_escalation_paths_show'
          case 'incidentio_escalation_paths_update':
            return 'incidentio_escalation_paths_update'
          case 'incidentio_escalation_paths_delete':
            return 'incidentio_escalation_paths_delete'
          case 'incidentio_on_call_now':
            return 'incidentio_on_call_now'
          case 'incidentio_schedule_overrides_list':
            return 'incidentio_schedule_overrides_list'
          case 'incidentio_alerts_list':
            return 'incidentio_alerts_list'
          case 'incidentio_alerts_show':
            return 'incidentio_alerts_show'
          case 'incidentio_alerts_resolve':
            return 'incidentio_alerts_resolve'
          case 'incidentio_alert_events_create':
            return 'incidentio_alert_events_create'
          case 'incidentio_incident_alerts_list':
            return 'incidentio_incident_alerts_list'
          case 'incidentio_escalations_cancel':
            return 'incidentio_escalations_cancel'
          case 'incidentio_catalog_types_list':
            return 'incidentio_catalog_types_list'
          case 'incidentio_catalog_entries_list':
            return 'incidentio_catalog_entries_list'
          case 'incidentio_teams_list':
            return 'incidentio_teams_list'
          case 'incidentio_teams_show':
            return 'incidentio_teams_show'
          case 'incidentio_follow_ups_create':
            return 'incidentio_follow_ups_create'
          case 'incidentio_follow_ups_update':
            return 'incidentio_follow_ups_update'
          case 'incidentio_actions_create':
            return 'incidentio_actions_create'
          case 'incidentio_actions_update':
            return 'incidentio_actions_update'
          case 'incidentio_incident_participants_list':
            return 'incidentio_incident_participants_list'
          case 'incidentio_incident_memberships_create':
            return 'incidentio_incident_memberships_create'
          case 'incidentio_incident_memberships_revoke':
            return 'incidentio_incident_memberships_revoke'
          default:
            return 'incidentio_incidents_list'
        }
      },
      params: (params) => {
        const result: Record<string, unknown> = {}
        const toBoolean = (value: unknown) => value === true || value === 'true'
        if (params.page_size) result.page_size = Number(params.page_size)
        if (params.notify_incident_channel !== undefined) {
          result.notify_incident_channel = toBoolean(params.notify_incident_channel)
        }
        if (params.include_private_incidents !== undefined) {
          result.include_private_incidents = toBoolean(params.include_private_incidents)
        }
        if (params.continue_on_step_error !== undefined) {
          result.continue_on_step_error = toBoolean(params.continue_on_step_error)
        }
        if (params.skip_step_upgrades !== undefined) {
          result.skip_step_upgrades = toBoolean(params.skip_step_upgrades)
        }
        if (params.operation === 'incidentio_users_list') {
          if (params.user_email) result.email = params.user_email
          if (params.user_slack_id) result.slack_user_id = params.user_slack_id
        }
        if (params.operation === 'incidentio_alerts_list') {
          if (params.alert_status) result.status = params.alert_status
          result.has_notes = toTriState(params.has_notes)
          result.include_maintenance_window = toTriState(params.include_maintenance_window)
        }
        if (params.operation === 'incidentio_alert_events_create') {
          if (params.alert_status) result.status = params.alert_status
          if (params.alert_title) result.title = params.alert_title
          if (params.alert_description) result.description = params.alert_description
        }
        if (
          params.operation === 'incidentio_follow_ups_create' ||
          params.operation === 'incidentio_follow_ups_update'
        ) {
          if (params.follow_up_title) result.title = params.follow_up_title
          if (params.follow_up_description) result.description = params.follow_up_description
        }
        if (
          params.operation === 'incidentio_actions_create' ||
          params.operation === 'incidentio_actions_update'
        ) {
          if (params.action_description) result.description = params.action_description
        }
        if (
          params.operation === 'incidentio_follow_ups_update' ||
          params.operation === 'incidentio_actions_update'
        ) {
          if (params.item_status) result.status = params.item_status
        }
        return result
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
    sort_by: { type: 'string', description: 'Incident sort order' },
    filter_mode: { type: 'string', description: 'Incident filter combination mode' },
    // Incident fields
    summary: { type: 'string', description: 'Incident summary' },
    severity_id: { type: 'string', description: 'Severity ID' },
    incident_type_id: { type: 'string', description: 'Incident type ID' },
    incident_status_id: { type: 'string', description: 'Incident status ID' },
    visibility: { type: 'string', description: 'Incident visibility' },
    incident_id: { type: 'string', description: 'Incident ID for filtering' },
    incident_mode: { type: 'string', description: 'Incident mode filter' },
    notify_incident_channel: {
      type: 'boolean',
      description: 'Whether to notify the incident channel',
    },
    // Workflow fields
    folder: { type: 'string', description: 'Workflow folder' },
    state: { type: 'string', description: 'Workflow state' },
    trigger: { type: 'string', description: 'Workflow trigger type' },
    skip_step_upgrades: { type: 'boolean', description: 'Whether to skip workflow step upgrades' },
    steps: { type: 'string', description: 'Workflow steps JSON' },
    condition_groups: { type: 'string', description: 'Workflow condition groups JSON' },
    runs_on_incidents: {
      type: 'string',
      description: 'Incident lifecycle filter for workflow runs',
    },
    runs_on_incident_modes: {
      type: 'string',
      description: 'Incident modes JSON for workflow runs',
    },
    include_private_incidents: {
      type: 'boolean',
      description: 'Whether the workflow includes private incidents',
    },
    continue_on_step_error: {
      type: 'boolean',
      description: 'Whether workflow execution continues after a step error',
    },
    once_for: { type: 'string', description: 'Workflow run-once fields JSON' },
    expressions: { type: 'string', description: 'Workflow expressions JSON' },
    delay: { type: 'string', description: 'Workflow delay JSON' },
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
    entry_window_start: { type: 'string', description: 'Schedule entry window start' },
    entry_window_end: { type: 'string', description: 'Schedule entry window end' },
    rotation_id: { type: 'string', description: 'Schedule rotation ID' },
    user_id: { type: 'string', description: 'User ID' },
    user_email: { type: 'string', description: 'User email' },
    user_slack_id: { type: 'string', description: 'User Slack ID' },
    start_at: { type: 'string', description: 'Start date/time' },
    end_at: { type: 'string', description: 'End date/time' },
    layer_id: { type: 'string', description: 'Schedule layer ID' },
    // Escalation Paths fields
    path: { type: 'json', description: 'Escalation path configuration' },
    working_hours: { type: 'json', description: 'Working hours configuration' },
    // Alert fields
    alert_id: { type: 'string', description: 'Alert ID' },
    alert_status: { type: 'string', description: 'Alert status (firing, resolved)' },
    status_operator: { type: 'string', description: 'How to match the alert status filter' },
    alert_source_id: { type: 'string', description: 'Alert source ID' },
    alert_source_operator: {
      type: 'string',
      description: 'How to match the alert source filter',
    },
    deduplication_key: { type: 'string', description: 'Alert deduplication key' },
    created_at_gte: { type: 'string', description: 'Earliest alert creation date' },
    created_at_lte: { type: 'string', description: 'Latest alert creation date' },
    has_notes: { type: 'string', description: 'Whether to filter on alerts having notes' },
    include_maintenance_window: {
      type: 'string',
      description: 'Whether to include alerts held by a maintenance window',
    },
    alert_source_config_id: { type: 'string', description: 'HTTP alert source config ID' },
    alert_source_token: { type: 'string', description: 'HTTP alert source token' },
    alert_title: { type: 'string', description: 'Alert title' },
    alert_description: { type: 'string', description: 'Alert description' },
    source_url: { type: 'string', description: 'Link to the alert in the upstream system' },
    metadata: { type: 'string', description: 'Alert metadata JSON' },
    // Catalog fields
    catalog_type_id: { type: 'string', description: 'Catalog type ID' },
    identifier: { type: 'string', description: 'Catalog entry identifier to match' },
    // Follow-up and Action fields
    follow_up_title: { type: 'string', description: 'Follow-up title' },
    follow_up_description: { type: 'string', description: 'Follow-up description' },
    action_description: { type: 'string', description: 'Action description' },
    item_status: { type: 'string', description: 'Follow-up or action status' },
    assignee_id: { type: 'string', description: 'ID of the user to assign to' },
    assignee_team_id: { type: 'string', description: 'ID of the team to assign to' },
    follow_up_category_id: { type: 'string', description: 'Follow-up category ID' },
    follow_up_priority_option_id: { type: 'string', description: 'Follow-up priority option ID' },
    external_issue_reference_id: { type: 'string', description: 'External issue reference ID' },
    labels: { type: 'string', description: 'Comma-separated follow-up labels' },
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
    management_meta: { type: 'json', description: 'Workflow management metadata' },
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
    override: { type: 'json', description: 'Schedule override details' },
    // Escalation Paths
    escalation_paths: { type: 'json', description: 'List of escalation paths' },
    escalation_path: { type: 'json', description: 'Escalation path details' },
    // On-call
    on_call: { type: 'json', description: 'Shifts that are ongoing right now' },
    next_on_call: { type: 'json', description: 'Shifts that take over at the next changeover' },
    // Schedule Overrides
    overrides: { type: 'json', description: 'List of schedule overrides' },
    // Alerts
    alerts: { type: 'json', description: 'List of alerts' },
    alert: { type: 'json', description: 'Alert details' },
    incident_alerts: { type: 'json', description: 'List of incident-to-alert connections' },
    deduplication_key: { type: 'string', description: 'Deduplication key of the alert event' },
    status: { type: 'string', description: 'Status of the alert event' },
    // Catalog
    catalog_types: { type: 'json', description: 'List of catalog types' },
    catalog_entries: { type: 'json', description: 'List of catalog entries' },
    catalog_type: { type: 'json', description: 'The catalog type the entries belong to' },
    // Teams
    teams: { type: 'json', description: 'List of teams' },
    team: { type: 'json', description: 'Team details' },
    // Incident people
    active: { type: 'json', description: 'Participants actively helping with the incident' },
    passive: { type: 'json', description: 'Participants observing the incident' },
    incident_membership: { type: 'json', description: 'Incident membership details' },
    // General
    message: { type: 'string', description: 'Operation result message' },
    pagination_meta: { type: 'json', description: 'Pagination metadata' },
  },
}

export const IncidentioBlockMeta = {
  tags: ['incident-management', 'monitoring'],
  url: 'https://incident.io',
  templates: [
    {
      icon: IncidentioIcon,
      title: 'incident.io commander',
      prompt:
        'Build a scheduled workflow that polls incident.io for newly declared incidents, opens a Slack war-room for each, invites responders from the on-call schedule, pulls related PagerDuty alerts, and pins the runbook.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['slack', 'pagerduty'],
    },
    {
      icon: IncidentioIcon,
      title: 'incident.io postmortem starter',
      prompt:
        'Create a scheduled workflow that polls incident.io for recently resolved incidents, pulls the Slack thread, related Sentry errors, and deploy timeline, then drafts a postmortem doc in Google Docs.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['sentry', 'google_docs'],
    },
    {
      icon: IncidentioIcon,
      title: 'incident.io action-item tracker',
      prompt:
        'Build a workflow that watches incident.io for new follow-up actions, creates Linear tickets for each, and writes a tracking table that surfaces overdue actions on a weekly digest.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: IncidentioIcon,
      title: 'incident.io weekly digest',
      prompt:
        'Create a scheduled weekly workflow that summarizes incident.io activity — declared incidents, MTTR, top affected services, action-item completion rate — and posts to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: IncidentioIcon,
      title: 'incident.io customer comms drafter',
      prompt:
        'Build a workflow that during a high-severity incident.io incident drafts customer status-page copy and a tailored email update, holds for approval, and dispatches once approved.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'communication'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: IncidentioIcon,
      title: 'incident.io SLO impact mapper',
      prompt:
        'Create a workflow that on each incident.io incident maps impacted services to active SLOs, calculates SLO burn, and writes the impact analysis back to the incident timeline.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'analysis'],
    },
    {
      icon: IncidentioIcon,
      title: 'incident.io noise filter',
      prompt:
        'Build a workflow that pulls incident.io declared incidents, classifies a subset as low-impact noise, auto-resolves them after auditing, and writes a noise-rate metric to a table.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
    },
  ],
  skills: [
    {
      name: 'declare-incident-from-alert',
      description:
        'Open an incident.io incident from an inbound alert with the right severity and summary.',
      content:
        '# Declare an Incident From an Alert\n\nTurn a monitoring alert into a structured incident.io incident so responders can act fast.\n\n## Steps\n1. Look up available severities and pick the one matching the alert impact.\n2. Create the incident with a clear name, a summary describing impact and affected service, and the chosen severity.\n3. Set incident type and any required custom fields from the alert payload.\n4. Capture the new incident reference and link.\n\n## Output\nReturn the incident ID, reference, severity, and link. Confirm the responder channel was created so the team can jump in.',
    },
    {
      name: 'post-incident-update',
      description:
        'Update an active incident with current status and a progress note for stakeholders.',
      content:
        '# Post an Incident Update\n\nKeep stakeholders informed by moving an active incident through its lifecycle.\n\n## Steps\n1. Look up the incident by reference or ID to confirm its current status.\n2. List valid incident statuses and choose the next one (investigating, identified, monitoring, resolved).\n3. Update the incident with the new status and a concise progress message.\n\n## Output\nReturn the incident reference, the new status, and a one-line summary of what changed and when.',
    },
    {
      name: 'on-call-handoff-report',
      description: 'Summarize who is on call and recent open incidents for an on-call handoff.',
      content:
        '# On-Call Handoff Report\n\nBuild a clean handoff so the next on-call engineer knows the state of the world.\n\n## Steps\n1. Get who is on call to read the ongoing shifts, and note the shifts that take over at the next changeover.\n2. List schedule overrides so any shift cover is reflected in the handoff.\n3. List recent incidents and filter to those that are open or recently resolved.\n4. For each open incident, capture severity, status, and outstanding follow-ups.\n\n## Output\nReturn a handoff brief: who is on call now and who takes over next, open incidents with severity and status, and follow-ups that still need owners.',
    },
    {
      name: 'triage-firing-alerts',
      description:
        'Review firing alerts, link them to incidents, and resolve the ones that are stale.',
      content:
        '# Triage Firing Alerts\n\nWork the firing alert queue so real problems get an incident and noise gets closed out.\n\n## Steps\n1. List alerts filtered to status firing, oldest first, and capture title, source, and when each started.\n2. For each alert, list incident alerts to see whether it is already attached to an incident.\n3. Group the unattached alerts by source and by the attributes they share.\n4. Resolve alerts that are clearly stale or already handled, and flag the rest for an incident.\n\n## Output\nReturn three lists: alerts already attached to an incident, alerts resolved as stale, and alerts that still need a human decision with the reason why.',
    },
    {
      name: 'page-the-on-call-for-a-service',
      description: 'Find who is on call for a service and raise an escalation to them.',
      content:
        '# Page the On-Call for a Service\n\nRoute an urgent problem to whoever is actually holding the pager right now.\n\n## Steps\n1. List catalog entries for the service catalog type to resolve the service and its owning team.\n2. Get who is on call and pick the shift covering that team’s schedule.\n3. List escalation paths and choose the one matching the service, falling back to the on-call user IDs.\n4. Create the escalation with a title naming the service and the symptom, using a unique idempotency key so a retry does not double-page.\n\n## Output\nReturn who was paged, the escalation ID, and the schedule the on-call shift came from. If nobody is on call for that schedule, say so instead of paging a fallback silently.',
    },
    {
      name: 'export-incident-followups',
      description:
        'Pull follow-ups from recent incidents into an actionable list for post-incident review.',
      content:
        '# Export Incident Follow-Ups\n\nGather the action items that came out of recent incidents so none slip through.\n\n## Steps\n1. List incidents within the target time window.\n2. For each, list its follow-ups and capture title, owner, status, and linked incident.\n3. Group follow-ups by owner and by open vs completed.\n\n## Output\nReturn a table of follow-ups grouped by owner with status and source incident, highlighting overdue or unassigned items.',
    },
  ],
} as const satisfies BlockMeta
