import { ServiceNowIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import {
  APPROVAL_DECISION_OPTIONS,
  APPROVAL_STATE,
  APPROVAL_STATE_OPTIONS,
  CHANGE_CLOSE_CODE_OPTIONS,
  CHANGE_STATE_OPTIONS,
  CHANGE_TYPE_OPTIONS,
  COMMENT_FIELD_OPTIONS,
  DISPLAY_VALUE_OPTIONS,
  IMPACT_URGENCY_OPTIONS,
  INCIDENT_STATE_OPTIONS,
  PRIORITY_OPTIONS,
} from '@/tools/servicenow/constants'
import type { ServiceNowResponse } from '@/tools/servicenow/types'
import { getTrigger } from '@/triggers'

const FILE_FIELD = ['uploadFile', 'fileReference'] as const

const RECORD_MATCH_FIELD = ['sysId', 'number', 'query'] as const

/** JSON-valued subblocks, paired with the control label to name in a parse error. */
const JSON_SUBBLOCKS = [
  ['additionalFields', 'Additional Fields'],
  ['variables', 'Item Variables'],
] as const

/**
 * Parses a JSON-valued subblock, naming the control the typo is in.
 *
 * `tools.config.params` runs unguarded, so a bare `JSON.parse` escapes as
 * `JSON Parse error: Expected '}'` with nothing pointing at the field to fix.
 */
function parseJsonSubBlock(value: string, label: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`${label} must be a JSON object`)
  }
}

/** Generic Table API operations, which address an arbitrary table by name. */
const GENERIC_TABLE_OPS = [
  'servicenow_create_record',
  'servicenow_read_record',
  'servicenow_update_record',
  'servicenow_delete_record',
  'servicenow_aggregate',
  'servicenow_list_attachments',
  'servicenow_upload_attachment',
] as const

/** Semantic operations that fetch exactly one record by number or sys_id. */
const SEMANTIC_GET_OPS = [
  'servicenow_get_incident',
  'servicenow_get_change_request',
  'servicenow_get_requested_item',
] as const

/** Semantic operations that return a filtered list of Table API records. */
const SEMANTIC_LIST_OPS = [
  'servicenow_list_incidents',
  'servicenow_list_change_requests',
  'servicenow_list_requested_items',
  'servicenow_list_approvals',
  'servicenow_search_cis',
  'servicenow_list_ci_relationships',
  'servicenow_find_user',
  'servicenow_list_group_members',
] as const

/** Semantic operations that create a record. */
const SEMANTIC_CREATE_OPS = [
  'servicenow_create_incident',
  'servicenow_create_change_request',
] as const

/** Semantic operations that update a record addressed by sys_id. */
const SEMANTIC_UPDATE_OPS = [
  'servicenow_update_incident',
  'servicenow_resolve_incident',
  'servicenow_close_incident',
  'servicenow_add_incident_comment',
  'servicenow_update_change_request',
  'servicenow_update_change_state',
] as const

/** Every operation that writes through the Table API. */
const SEMANTIC_WRITE_OPS = [...SEMANTIC_CREATE_OPS, ...SEMANTIC_UPDATE_OPS] as const

/**
 * Every operation whose tool spreads `writeParams` — `fields`, `displayValue`,
 * and `inputDisplayValue`.
 *
 * `update_approval` addresses its record by `approvalSysId` rather than the
 * shared `sysId`, so it stays out of `SEMANTIC_UPDATE_OPS`, but it declares the
 * same write params. Leaving it out of these controls made it the one operation
 * where a stale advanced `displayValue`/`returnFields` reached the wire unseen.
 */
const SEMANTIC_WRITE_PARAM_OPS = [...SEMANTIC_WRITE_OPS, 'servicenow_update_approval'] as const

/**
 * Write operations that accept the raw `additionalFields` escape hatch. Excludes
 * `add_incident_comment`, whose body is exactly one journal field, so a value
 * entered there would be silently discarded.
 */
const ADDITIONAL_FIELDS_OPS = SEMANTIC_WRITE_OPS.filter(
  (op) => op !== 'servicenow_add_incident_comment'
)

/** Every operation that reads through the Table API. */
const SEMANTIC_READ_OPS = [...SEMANTIC_GET_OPS, ...SEMANTIC_LIST_OPS] as const

/** Operations that accept a `limit`/`offset` pair of some kind. */
const PAGINATED_OPS = [
  ...SEMANTIC_LIST_OPS,
  'servicenow_list_change_tasks',
  'servicenow_list_catalog_items',
  'servicenow_search_knowledge',
] as const

/**
 * Operations whose `sysparm_display_value` comes from the semantic `all`-defaulted
 * control rather than the generic Table API one, which stays unset by default so
 * the pre-existing generic tools keep their original wire behavior.
 */
const SEMANTIC_DISPLAY_VALUE_OPS: ReadonlySet<string> = new Set([
  ...SEMANTIC_READ_OPS,
  ...SEMANTIC_WRITE_PARAM_OPS,
])

/** Operations whose tool takes a `state`, from whichever control owns that state model. */
const SEMANTIC_STATE_OPS: ReadonlySet<string> = new Set([
  'servicenow_create_incident',
  'servicenow_list_incidents',
  'servicenow_update_incident',
  'servicenow_list_change_requests',
  'servicenow_update_change_request',
  'servicenow_update_change_state',
  'servicenow_list_approvals',
])

/** Operations whose `state` comes from the change model rather than the incident one. */
const CHANGE_STATE_OPS: ReadonlySet<string> = new Set([
  'servicenow_list_change_requests',
  'servicenow_update_change_request',
])

/** Operations whose close code and notes are the change model's, not an incident's. */
const CHANGE_CLOSE_OPS: ReadonlySet<string> = new Set([
  'servicenow_update_change_request',
  'servicenow_update_change_state',
])

const OPTIONAL_CHOICE = { label: 'Any (not set)', id: '' } as const

const optionalChoices = <T extends { label: string; id: string }>(options: readonly T[]) => [
  OPTIONAL_CHOICE,
  ...options,
]

export const ServiceNowBlock: BlockConfig<ServiceNowResponse> = {
  type: 'servicenow',
  name: 'ServiceNow',
  description: 'Create, read, update, and delete ServiceNow records',
  longDescription:
    'Integrate ServiceNow into your workflow. Create, read, update, and delete records in any ServiceNow table including incidents, tasks, change requests, users, and more.',
  docsLink: 'https://docs.sim.ai/integrations/servicenow',
  category: 'tools',
  integrationType: IntegrationType.Support,
  authMode: AuthMode.ApiKey,
  bgColor: '#032D42',
  icon: ServiceNowIcon,
  canvasPresentation: {
    defaultTitle: 'ServiceNow',
    triggerSentences: {
      default: [
        'Run on',
        { field: 'selectedTriggerId', core: true },
        { text: 'in table', field: 'tableName' },
      ],
      byTrigger: {
        servicenow_webhook: ['Run on any record event', { text: 'in table', field: 'tableName' }],
      },
    },
    sentences: {
      byOperation: {
        servicenow_create_record: [
          { text: 'Create a record in', field: 'tableName', core: true },
          { text: ', with', field: 'fields' },
        ],
        servicenow_read_record: [
          'Read records',
          { text: 'from', field: 'tableName', core: true },
          { text: ', matching', field: RECORD_MATCH_FIELD },
          { text: ', up to', field: 'limit' },
        ],
        servicenow_update_record: [
          { text: 'Update record', field: 'sysId', core: true },
          { text: 'in', field: 'tableName' },
          { text: ', setting', field: 'fields' },
        ],
        servicenow_delete_record: [
          { text: 'Delete record', field: 'sysId', core: true },
          { text: 'from', field: 'tableName' },
        ],
        servicenow_aggregate: [
          { text: 'Aggregate records in', field: 'tableName', core: true },
          { text: ', grouped by', field: 'groupBy' },
          { text: ', where', field: 'query' },
        ],
        servicenow_list_attachments: [
          { text: 'List attachments on record', field: 'recordSysId', core: true },
          { text: 'in', field: 'tableName' },
        ],
        servicenow_download_attachment: [
          { text: 'Download attachment', field: 'attachmentSysId', core: true },
        ],
        servicenow_upload_attachment: [
          { text: 'Attach', field: FILE_FIELD, core: true },
          { text: 'to record', field: 'recordSysId', core: true },
          { text: 'in', field: 'tableName' },
        ],
        servicenow_create_incident: [
          { text: 'Create an incident', field: 'shortDescription', core: true },
          { text: 'for caller', field: 'callerId' },
          { text: ', assigned to', field: 'assignmentGroup' },
        ],
        servicenow_get_incident: [{ text: 'Get incident', field: ['number', 'sysId'], core: true }],
        servicenow_list_incidents: [
          'List incidents',
          { text: 'matching', field: 'searchText', core: true },
          { text: ', in state', field: 'incidentState' },
          { text: ', up to', field: 'limit' },
        ],
        servicenow_update_incident: [
          { text: 'Update incident', field: 'sysId', core: true },
          { text: ', setting state', field: 'incidentState' },
          { text: ', assigning to', field: 'assignedTo' },
        ],
        servicenow_resolve_incident: [
          { text: 'Resolve incident', field: 'sysId', core: true },
          { text: 'with code', field: 'resolutionCode' },
          { text: ', noting', field: 'resolutionNotes' },
        ],
        servicenow_close_incident: [
          { text: 'Close incident', field: 'sysId', core: true },
          { text: 'with code', field: 'resolutionCode' },
          { text: ', noting', field: 'resolutionNotes' },
        ],
        servicenow_add_incident_comment: [
          { text: 'Comment on incident', field: 'sysId', core: true },
          { text: 'in', field: 'commentField' },
          { text: ', saying', field: 'comment' },
        ],
        servicenow_create_change_request: [
          { text: 'Create a change request', field: 'shortDescription', core: true },
          { text: 'of type', field: 'type' },
          { text: ', assigned to', field: 'assignmentGroup' },
        ],
        servicenow_get_change_request: [
          { text: 'Get change request', field: ['number', 'sysId'], core: true },
        ],
        servicenow_list_change_requests: [
          'List change requests',
          { text: 'matching', field: 'searchText', core: true },
          { text: ', in state', field: 'changeState' },
          { text: ', up to', field: 'limit' },
        ],
        servicenow_update_change_request: [
          { text: 'Update change request', field: 'sysId', core: true },
          { text: ', setting state', field: 'changeState' },
          { text: ', assigning to', field: 'assignedTo' },
        ],
        servicenow_update_change_state: [
          { text: 'Move change request', field: 'sysId', core: true },
          { text: 'to state', field: 'targetState', core: true },
        ],
        servicenow_list_change_tasks: [
          { text: 'List tasks on change request', field: 'changeSysId', core: true },
          { text: ', matching', field: 'query' },
        ],
        servicenow_get_change_next_states: [
          {
            text: 'Get the next available states for change request',
            field: 'changeSysId',
            core: true,
          },
        ],
        servicenow_list_catalog_items: [
          'List catalog items',
          { text: 'matching', field: 'searchText', core: true },
          { text: ', in category', field: 'categorySysId' },
        ],
        servicenow_order_catalog_item: [
          { text: 'Order catalog item', field: 'catalogItemSysId', core: true },
          { text: ', quantity', field: 'quantity' },
          { text: ', for', field: 'requestedFor' },
        ],
        servicenow_list_requested_items: [
          'List requested items',
          { text: 'on request', field: 'requestSysId', core: true },
          { text: ', for catalog item', field: 'catalogItemSysId' },
        ],
        servicenow_get_requested_item: [
          { text: 'Get requested item', field: ['number', 'sysId'], core: true },
        ],
        servicenow_list_approvals: [
          'List approvals',
          { text: 'for approver', field: 'approverSysId', core: true },
          { text: ', in state', field: 'approvalState' },
        ],
        servicenow_update_approval: [
          { text: 'Record decision', field: 'decision', core: true },
          { text: 'on approval', field: 'approvalSysId', core: true },
        ],
        servicenow_search_cis: [
          'Search configuration items',
          { text: 'named', field: 'name', core: true },
          { text: ', in class', field: 'ciClass' },
          { text: ', up to', field: 'limit' },
        ],
        servicenow_get_ci: [
          { text: 'Get configuration item', field: 'sysId', core: true },
          { text: 'in class', field: 'ciClass' },
        ],
        servicenow_list_ci_relationships: [
          { text: 'List relationships for CI', field: 'ciSysId', core: true },
          { text: ', on the', field: 'direction' },
        ],
        servicenow_search_knowledge: [
          'Search knowledge articles',
          { text: 'for', field: 'knowledgeQuery', core: true },
          { text: ', up to', field: 'limit' },
        ],
        servicenow_get_knowledge_article: [
          { text: 'Get knowledge article', field: 'articleId', core: true },
        ],
        servicenow_find_user: [
          'Find users',
          { text: 'by email', field: 'email', core: true },
          { text: ', by user name', field: 'userName' },
          { text: ', by name', field: 'name' },
        ],
        servicenow_list_group_members: [
          'List members of group',
          { text: 'named', field: 'groupName', core: true },
          { text: ', with sys_id', field: 'groupSysId' },
        ],
      },
    },
  },
  subBlocks: [
    // Operation selector
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Incident', id: 'servicenow_create_incident' },
        { label: 'Get Incident', id: 'servicenow_get_incident' },
        { label: 'List Incidents', id: 'servicenow_list_incidents' },
        { label: 'Update Incident', id: 'servicenow_update_incident' },
        { label: 'Resolve Incident', id: 'servicenow_resolve_incident' },
        { label: 'Close Incident', id: 'servicenow_close_incident' },
        { label: 'Add Incident Comment', id: 'servicenow_add_incident_comment' },
        { label: 'Create Change Request', id: 'servicenow_create_change_request' },
        { label: 'Get Change Request', id: 'servicenow_get_change_request' },
        { label: 'List Change Requests', id: 'servicenow_list_change_requests' },
        { label: 'Update Change Request', id: 'servicenow_update_change_request' },
        { label: 'Move Change State', id: 'servicenow_update_change_state' },
        { label: 'List Change Tasks', id: 'servicenow_list_change_tasks' },
        { label: 'Get Change Next States', id: 'servicenow_get_change_next_states' },
        { label: 'List Catalog Items', id: 'servicenow_list_catalog_items' },
        { label: 'Order Catalog Item', id: 'servicenow_order_catalog_item' },
        { label: 'List Requested Items', id: 'servicenow_list_requested_items' },
        { label: 'Get Requested Item', id: 'servicenow_get_requested_item' },
        { label: 'List Approvals', id: 'servicenow_list_approvals' },
        { label: 'Approve or Reject', id: 'servicenow_update_approval' },
        { label: 'Search Configuration Items', id: 'servicenow_search_cis' },
        { label: 'Get Configuration Item', id: 'servicenow_get_ci' },
        { label: 'List CI Relationships', id: 'servicenow_list_ci_relationships' },
        { label: 'Search Knowledge', id: 'servicenow_search_knowledge' },
        { label: 'Get Knowledge Article', id: 'servicenow_get_knowledge_article' },
        { label: 'Find User', id: 'servicenow_find_user' },
        { label: 'List Group Members', id: 'servicenow_list_group_members' },
        { label: 'Create Record', id: 'servicenow_create_record' },
        { label: 'Read Records', id: 'servicenow_read_record' },
        { label: 'Update Record', id: 'servicenow_update_record' },
        { label: 'Delete Record', id: 'servicenow_delete_record' },
        { label: 'Aggregate Records', id: 'servicenow_aggregate' },
        { label: 'List Attachments', id: 'servicenow_list_attachments' },
        { label: 'Download Attachment', id: 'servicenow_download_attachment' },
        { label: 'Upload Attachment', id: 'servicenow_upload_attachment' },
      ],
      value: () => 'servicenow_list_incidents',
    },
    // Instance URL
    {
      id: 'instanceUrl',
      title: 'Instance URL',
      type: 'short-input',
      placeholder: 'https://instance.service-now.com',
      required: true,
      description: 'Your ServiceNow instance URL (e.g., https://yourcompany.service-now.com)',
    },
    // Username
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'Enter your ServiceNow username',
      required: true,
      description: 'ServiceNow user with web service access',
    },
    // Password
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      placeholder: 'Enter your ServiceNow password',
      password: true,
      required: true,
      description: 'Password for the ServiceNow user',
    },
    // Table Name (not needed for download attachment, which is addressed by attachment sys_id)
    {
      id: 'tableName',
      title: 'Table Name',
      type: 'short-input',
      placeholder: 'incident, task, sys_user, etc.',
      condition: { field: 'operation', value: [...GENERIC_TABLE_OPS] },
      required: true,
      description: 'ServiceNow table name',
    },
    // Create-specific: Fields
    {
      id: 'fields',
      title: 'Fields (JSON)',
      type: 'code',
      language: 'json',
      placeholder: '{\n  "short_description": "Issue description",\n  "priority": "1"\n}',
      condition: { field: 'operation', value: 'servicenow_create_record' },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert ServiceNow developer. Generate ServiceNow record field objects as JSON based on the user's request.

### CONTEXT
ServiceNow records use specific field names depending on the table. Common tables and their key fields include:
- incident: short_description, description, priority (1-5), urgency (1-3), impact (1-3), caller_id, assignment_group, assigned_to, category, subcategory, state
- task: short_description, description, priority, assignment_group, assigned_to, state
- sys_user: user_name, first_name, last_name, email, active, department, title
- change_request: short_description, description, type, risk, impact, priority, assignment_group

### RULES
- Output ONLY valid JSON object starting with { and ending with }
- Use correct ServiceNow field names for the target table
- Values should be strings unless the field specifically requires another type
- For reference fields (like caller_id, assigned_to), use sys_id values or display values
- Do not include sys_id in create operations (it's auto-generated)

### EXAMPLE
User: "Create a high priority incident for network outage"
Output: {"short_description": "Network outage", "description": "Network connectivity issue affecting users", "priority": "1", "urgency": "1", "impact": "1", "category": "Network"}`,
        generationType: 'json-object',
      },
    },
    // Read-specific: Query options
    {
      id: 'sysId',
      title: 'Record sys_id',
      type: 'short-input',
      placeholder: 'Specific record sys_id (optional)',
      condition: {
        field: 'operation',
        value: ['servicenow_read_record', ...SEMANTIC_GET_OPS],
      },
    },
    {
      id: 'number',
      title: 'Record Number',
      type: 'short-input',
      placeholder: 'e.g., INC0010001 (optional)',
      condition: {
        field: 'operation',
        value: ['servicenow_read_record', ...SEMANTIC_GET_OPS],
      },
    },
    {
      id: 'query',
      title: 'Query String',
      type: 'short-input',
      placeholder: 'active=true^priority=1',
      condition: {
        field: 'operation',
        value: [
          'servicenow_read_record',
          'servicenow_aggregate',
          'servicenow_list_change_tasks',
          ...SEMANTIC_LIST_OPS,
        ],
      },
      description: 'ServiceNow encoded query string, ANDed with the other filters',
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: ['servicenow_read_record', ...PAGINATED_OPS] },
      description:
        'Maximum number of records to return. Left blank, no limit is sent and the instance applies its own default, which is 10,000 on the Table API operations',
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: ['servicenow_read_record', ...PAGINATED_OPS] },
      description: 'Number of records to skip for pagination',
      mode: 'advanced',
    },
    {
      id: 'displayValue',
      title: 'Display Value',
      type: 'dropdown',
      options: [
        { label: 'Default (not set)', id: '' },
        { label: 'False (sys_id only)', id: 'false' },
        { label: 'True (display value only)', id: 'true' },
        { label: 'All (both)', id: 'all' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: ['servicenow_read_record', 'servicenow_aggregate'],
      },
      description: 'Return display values for reference fields instead of sys_ids',
      mode: 'advanced',
    },
    {
      id: 'semanticDisplayValue',
      title: 'Display Value',
      type: 'dropdown',
      options: [...DISPLAY_VALUE_OPTIONS],
      value: () => 'all',
      condition: {
        field: 'operation',
        value: [...SEMANTIC_READ_OPS, ...SEMANTIC_WRITE_PARAM_OPS],
      },
      description:
        'How reference and choice fields come back. "all" (the default) returns both the sys_id and the label as {value, display_value}.',
      mode: 'advanced',
    },
    /**
     * Read Records keeps its projection on its own id.
     *
     * Sharing `fields` with the Create/Update Record JSON bodies meant one
     * stored value served two value spaces: a projection selected into Create
     * Record threw an uncaught `SyntaxError`, and a JSON body selected into
     * Read Records went out as `sysparm_fields=[object Object]`.
     */
    {
      id: 'readFields',
      title: 'Fields to Return',
      type: 'short-input',
      placeholder: 'number,short_description,priority',
      condition: { field: 'operation', value: 'servicenow_read_record' },
      description: 'Comma-separated list of fields',
      mode: 'advanced',
    },
    {
      id: 'returnFields',
      title: 'Fields to Return',
      type: 'short-input',
      placeholder: 'number,short_description,priority',
      condition: {
        field: 'operation',
        value: [
          'servicenow_search_knowledge',
          'servicenow_get_knowledge_article',
          ...SEMANTIC_READ_OPS,
          ...SEMANTIC_WRITE_PARAM_OPS,
        ],
      },
      description: 'Comma-separated list of fields',
      mode: 'advanced',
    },
    // Update-specific: sysId and fields
    {
      id: 'sysId',
      title: 'Record sys_id',
      type: 'short-input',
      placeholder: 'Record sys_id to update',
      condition: { field: 'operation', value: 'servicenow_update_record' },
      required: true,
    },
    {
      id: 'fields',
      title: 'Fields to Update (JSON)',
      type: 'code',
      language: 'json',
      placeholder: '{\n  "state": "2",\n  "assigned_to": "user.sys_id"\n}',
      condition: { field: 'operation', value: 'servicenow_update_record' },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert ServiceNow developer. Generate ServiceNow record update field objects as JSON based on the user's request.

### CONTEXT
ServiceNow records use specific field names depending on the table. Common update scenarios include:
- incident: state (1=New, 2=In Progress, 3=On Hold, 6=Resolved, 7=Closed), assigned_to, work_notes, close_notes, close_code
- task: state, assigned_to, work_notes, percent_complete
- change_request: state, risk, approval, work_notes

### RULES
- Output ONLY valid JSON object starting with { and ending with }
- Include only the fields that need to be updated
- Use correct ServiceNow field names for the target table
- For state transitions, use the correct numeric state values
- work_notes and comments fields append to existing values

### EXAMPLE
User: "Assign the incident to John and set to in progress"
Output: {"state": "2", "assigned_to": "john.doe", "work_notes": "Assigned and starting investigation"}`,
        generationType: 'json-object',
      },
    },
    // Delete-specific: sysId
    {
      id: 'sysId',
      title: 'Record sys_id',
      type: 'short-input',
      placeholder: 'Record sys_id to delete',
      condition: { field: 'operation', value: 'servicenow_delete_record' },
      required: true,
    },
    // Aggregate-specific
    {
      id: 'count',
      title: 'Return Count',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'servicenow_aggregate' },
      description: 'Return the count of matching records',
    },
    {
      id: 'groupBy',
      title: 'Group By',
      type: 'short-input',
      placeholder: 'category,priority',
      condition: { field: 'operation', value: 'servicenow_aggregate' },
      description: 'Comma-separated fields to group results by',
    },
    {
      id: 'avgFields',
      title: 'Average Fields',
      type: 'short-input',
      placeholder: 'reassignment_count',
      condition: { field: 'operation', value: 'servicenow_aggregate' },
      description: 'Comma-separated numeric fields to average',
      mode: 'advanced',
    },
    {
      id: 'sumFields',
      title: 'Sum Fields',
      type: 'short-input',
      placeholder: 'business_duration',
      condition: { field: 'operation', value: 'servicenow_aggregate' },
      description: 'Comma-separated numeric fields to sum',
      mode: 'advanced',
    },
    {
      id: 'minFields',
      title: 'Min Fields',
      type: 'short-input',
      placeholder: 'opened_at',
      condition: { field: 'operation', value: 'servicenow_aggregate' },
      description: 'Comma-separated fields to compute the minimum of',
      mode: 'advanced',
    },
    {
      id: 'maxFields',
      title: 'Max Fields',
      type: 'short-input',
      placeholder: 'closed_at',
      condition: { field: 'operation', value: 'servicenow_aggregate' },
      description: 'Comma-separated fields to compute the maximum of',
      mode: 'advanced',
    },
    {
      id: 'having',
      title: 'Having',
      type: 'short-input',
      placeholder: 'count^priority^>^3',
      condition: { field: 'operation', value: 'servicenow_aggregate' },
      description:
        'Filter on aggregate results, written as aggregate^field^operator^value and comma-separated for more than one',
      mode: 'advanced',
    },
    // Attachment record sys_id (list + upload)
    {
      id: 'recordSysId',
      title: 'Record sys_id',
      type: 'short-input',
      placeholder: 'sys_id of the record',
      condition: {
        field: 'operation',
        value: ['servicenow_list_attachments', 'servicenow_upload_attachment'],
      },
      required: true,
      description: 'sys_id of the record the attachment belongs to',
    },
    // List attachments: limit (unique id to avoid sharing the Read Records `limit` value)
    {
      id: 'attachmentLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'servicenow_list_attachments' },
      description: 'Maximum number of attachments to return',
      mode: 'advanced',
    },
    // Download attachment: attachment sys_id
    {
      id: 'attachmentSysId',
      title: 'Attachment sys_id',
      type: 'short-input',
      placeholder: 'sys_id of the attachment',
      condition: { field: 'operation', value: 'servicenow_download_attachment' },
      required: true,
      description: 'sys_id of the attachment to download (from List Attachments)',
    },
    // Upload attachment: file name + file
    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'logs.txt',
      condition: { field: 'operation', value: 'servicenow_upload_attachment' },
      required: true,
      description: 'Name to give the uploaded file',
    },
    {
      id: 'uploadFile',
      title: 'File',
      type: 'file-upload',
      canonicalParamId: 'file',
      placeholder: 'Upload a file',
      condition: { field: 'operation', value: 'servicenow_upload_attachment' },
      mode: 'basic',
      multiple: false,
      required: true,
    },
    {
      id: 'fileReference',
      title: 'File',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'Reference a file from previous blocks (e.g., {{block_1.output.file}})',
      condition: { field: 'operation', value: 'servicenow_upload_attachment' },
      mode: 'advanced',
      required: true,
    },
    // Semantic operations: record being written to
    {
      id: 'sysId',
      title: 'Record sys_id',
      type: 'short-input',
      placeholder: 'sys_id of the record to update',
      condition: { field: 'operation', value: [...SEMANTIC_UPDATE_OPS] },
      required: true,
      description:
        'The Table API addresses updates by sys_id. Look the record up first if you only have its number.',
    },
    {
      id: 'sysId',
      title: 'Configuration Item sys_id',
      type: 'short-input',
      placeholder: 'sys_id of the CI',
      condition: { field: 'operation', value: 'servicenow_get_ci' },
      required: true,
    },
    // Incident and change: core fields
    {
      id: 'shortDescription',
      title: 'Short Description',
      type: 'short-input',
      placeholder: 'One-line summary',
      condition: {
        field: 'operation',
        value: [
          'servicenow_create_incident',
          'servicenow_create_change_request',
          'servicenow_update_incident',
          'servicenow_update_change_request',
        ],
      },
      required: {
        field: 'operation',
        value: ['servicenow_create_incident', 'servicenow_create_change_request'],
      },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Detailed description',
      condition: {
        field: 'operation',
        value: [
          'servicenow_create_incident',
          'servicenow_create_change_request',
          'servicenow_update_incident',
          'servicenow_update_change_request',
        ],
      },
    },
    {
      id: 'searchText',
      title: 'Search Text',
      type: 'short-input',
      placeholder: 'Text to match in the short description',
      condition: {
        field: 'operation',
        value: [
          'servicenow_list_incidents',
          'servicenow_list_change_requests',
          'servicenow_list_catalog_items',
        ],
      },
      description: 'LIKE match — matches anywhere in the field',
    },
    // State dropdowns — one per state model
    {
      id: 'incidentState',
      title: 'Incident State',
      type: 'combobox',
      options: optionalChoices(INCIDENT_STATE_OPTIONS),
      value: () => '',
      condition: {
        field: 'operation',
        value: [
          'servicenow_create_incident',
          'servicenow_list_incidents',
          'servicenow_update_incident',
        ],
      },
      description:
        'Base-system incident states. Instances with a customized state model can use different coded values. Moving to On Hold also needs an On hold reason (Awaiting Caller, Awaiting Change, Awaiting Problem, or Awaiting Vendor), which you set through Additional Fields; Awaiting Caller additionally requires Additional Comments.',
    },
    {
      id: 'changeState',
      title: 'Change State',
      type: 'combobox',
      options: optionalChoices(CHANGE_STATE_OPTIONS),
      value: () => '',
      condition: {
        field: 'operation',
        value: ['servicenow_list_change_requests', 'servicenow_update_change_request'],
      },
      description:
        'Base-system change model states. Instances with a customized state model can use different coded values.',
    },
    {
      id: 'targetState',
      title: 'Target State',
      type: 'combobox',
      options: [...CHANGE_STATE_OPTIONS],
      /**
       * Deliberately unseeded. A seeded first option ("New") meant running the
       * operation untouched moved the change backwards; `required` now forces an
       * explicit choice instead.
       */
      condition: { field: 'operation', value: 'servicenow_update_change_state' },
      required: true,
      description:
        'The change state machine rejects a transition whose conditions have not been met.',
    },
    {
      id: 'approvalState',
      title: 'Approval State',
      type: 'combobox',
      options: [{ label: 'Any (not set)', id: '' }, ...APPROVAL_STATE_OPTIONS],
      value: () => APPROVAL_STATE.REQUESTED,
      condition: { field: 'operation', value: 'servicenow_list_approvals' },
      description:
        'The seven states ServiceNow publishes for the Ask for Approval action. An instance that defines further approval states can be filtered by typing the raw value.',
    },
    // Prioritization
    {
      id: 'impact',
      title: 'Impact',
      type: 'combobox',
      options: optionalChoices(IMPACT_URGENCY_OPTIONS),
      value: () => '',
      condition: {
        field: 'operation',
        value: [
          'servicenow_create_incident',
          'servicenow_update_incident',
          'servicenow_create_change_request',
          'servicenow_update_change_request',
        ],
      },
    },
    {
      id: 'urgency',
      title: 'Urgency',
      type: 'combobox',
      options: optionalChoices(IMPACT_URGENCY_OPTIONS),
      value: () => '',
      condition: {
        field: 'operation',
        value: ['servicenow_create_incident', 'servicenow_update_incident'],
      },
    },
    {
      id: 'priority',
      title: 'Priority',
      type: 'combobox',
      options: optionalChoices(PRIORITY_OPTIONS),
      value: () => '',
      condition: {
        field: 'operation',
        value: [
          'servicenow_create_incident',
          'servicenow_list_incidents',
          'servicenow_update_incident',
          'servicenow_create_change_request',
          'servicenow_update_change_request',
        ],
      },
      description: 'Normally derived from impact and urgency.',
      mode: 'advanced',
    },
    // Categorization
    {
      id: 'category',
      title: 'Category',
      type: 'short-input',
      placeholder: 'e.g., network',
      condition: {
        field: 'operation',
        value: [
          'servicenow_create_incident',
          'servicenow_update_incident',
          'servicenow_create_change_request',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'subcategory',
      title: 'Subcategory',
      type: 'short-input',
      placeholder: 'e.g., dhcp',
      condition: {
        field: 'operation',
        value: ['servicenow_create_incident', 'servicenow_update_incident'],
      },
      mode: 'advanced',
    },
    {
      id: 'contactType',
      title: 'Channel',
      type: 'short-input',
      placeholder: 'e.g., email, phone, self-service',
      condition: { field: 'operation', value: 'servicenow_create_incident' },
      description: 'The contact_type field',
      mode: 'advanced',
    },
    // Reference fields
    {
      id: 'callerId',
      title: 'Caller sys_id',
      type: 'short-input',
      placeholder: 'sys_id of the sys_user who reported the issue',
      condition: {
        field: 'operation',
        value: ['servicenow_create_incident', 'servicenow_list_incidents'],
      },
      description: 'Use Find User to resolve an email address to a sys_id.',
    },
    {
      id: 'assignmentGroup',
      title: 'Assignment Group sys_id',
      type: 'short-input',
      placeholder: 'sys_id of the sys_user_group',
      condition: {
        field: 'operation',
        value: [
          'servicenow_create_incident',
          'servicenow_list_incidents',
          'servicenow_update_incident',
          'servicenow_create_change_request',
          'servicenow_list_change_requests',
          'servicenow_update_change_request',
        ],
      },
    },
    {
      id: 'assignedTo',
      title: 'Assigned To sys_id',
      type: 'short-input',
      placeholder: 'sys_id of the sys_user',
      condition: {
        field: 'operation',
        value: [
          'servicenow_create_incident',
          'servicenow_list_incidents',
          'servicenow_update_incident',
          'servicenow_create_change_request',
          'servicenow_list_change_requests',
          'servicenow_update_change_request',
        ],
      },
    },
    {
      id: 'cmdbCi',
      title: 'Configuration Item sys_id',
      type: 'short-input',
      placeholder: 'sys_id of the affected CI',
      condition: {
        field: 'operation',
        value: [
          'servicenow_create_incident',
          'servicenow_update_incident',
          'servicenow_create_change_request',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'businessService',
      title: 'Service sys_id',
      type: 'short-input',
      placeholder: 'sys_id of the affected business service',
      condition: { field: 'operation', value: 'servicenow_create_incident' },
      mode: 'advanced',
    },
    {
      id: 'requestedBy',
      title: 'Requested By sys_id',
      type: 'short-input',
      placeholder: 'sys_id of the sys_user',
      condition: { field: 'operation', value: 'servicenow_create_change_request' },
      mode: 'advanced',
    },
    {
      id: 'active',
      title: 'Active',
      type: 'dropdown',
      options: [
        { label: 'Any (not set)', id: '' },
        { label: 'Active only', id: 'true' },
        { label: 'Inactive only', id: 'false' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: [
          'servicenow_list_incidents',
          'servicenow_list_change_requests',
          'servicenow_list_requested_items',
          'servicenow_find_user',
        ],
      },
      mode: 'advanced',
    },
    // Journal fields
    {
      id: 'workNotes',
      title: 'Work Notes',
      type: 'long-input',
      placeholder: 'Internal note',
      condition: {
        field: 'operation',
        value: [
          'servicenow_create_incident',
          'servicenow_update_incident',
          'servicenow_resolve_incident',
          'servicenow_close_incident',
          'servicenow_update_change_request',
          'servicenow_update_change_state',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'incidentComments',
      title: 'Additional Comments',
      type: 'long-input',
      placeholder: 'Customer-visible comment',
      condition: {
        field: 'operation',
        value: ['servicenow_create_incident', 'servicenow_update_incident'],
      },
      mode: 'advanced',
    },
    {
      id: 'approvalComments',
      title: 'Approval Comments',
      type: 'long-input',
      placeholder: 'Reason for the decision',
      condition: { field: 'operation', value: 'servicenow_update_approval' },
    },
    {
      id: 'comment',
      title: 'Comment',
      type: 'long-input',
      placeholder: 'Text to append to the journal field',
      condition: { field: 'operation', value: 'servicenow_add_incident_comment' },
      required: true,
    },
    {
      id: 'commentField',
      title: 'Journal Field',
      type: 'dropdown',
      options: [...COMMENT_FIELD_OPTIONS],
      value: () => COMMENT_FIELD_OPTIONS[0].id,
      condition: { field: 'operation', value: 'servicenow_add_incident_comment' },
    },
    // Resolution and closure
    {
      id: 'resolutionCode',
      title: 'Resolution Code',
      type: 'short-input',
      placeholder: 'A close_code choice configured on your instance',
      condition: {
        field: 'operation',
        value: ['servicenow_resolve_incident', 'servicenow_close_incident'],
      },
      required: true,
      description: 'The incident close_code choice list is configured per instance.',
    },
    {
      id: 'changeCloseCode',
      title: 'Close Code',
      type: 'combobox',
      options: optionalChoices(CHANGE_CLOSE_CODE_OPTIONS),
      value: () => '',
      condition: {
        field: 'operation',
        value: ['servicenow_update_change_request', 'servicenow_update_change_state'],
      },
      description: 'Required when moving a change request to Closed.',
    },
    {
      id: 'resolutionNotes',
      title: 'Resolution Notes',
      type: 'long-input',
      placeholder: 'How the record was resolved',
      condition: {
        field: 'operation',
        value: ['servicenow_resolve_incident', 'servicenow_close_incident'],
      },
      required: true,
    },
    {
      id: 'changeCloseNotes',
      title: 'Close Notes',
      type: 'long-input',
      placeholder: 'Outcome of the change',
      condition: {
        field: 'operation',
        value: ['servicenow_update_change_request', 'servicenow_update_change_state'],
      },
    },
    // Change-specific
    {
      id: 'type',
      title: 'Change Type',
      type: 'combobox',
      options: optionalChoices(CHANGE_TYPE_OPTIONS),
      value: () => '',
      condition: {
        field: 'operation',
        value: ['servicenow_create_change_request', 'servicenow_list_change_requests'],
      },
    },
    {
      id: 'risk',
      title: 'Risk',
      type: 'short-input',
      placeholder: 'Risk coded value',
      condition: {
        field: 'operation',
        value: [
          'servicenow_create_change_request',
          'servicenow_list_change_requests',
          'servicenow_update_change_request',
        ],
      },
      description: 'The risk choice list is configured per instance.',
      mode: 'advanced',
    },
    {
      id: 'startDate',
      title: 'Planned Start',
      type: 'short-input',
      placeholder: '2026-01-15 09:00:00',
      condition: {
        field: 'operation',
        value: ['servicenow_create_change_request', 'servicenow_update_change_request'],
      },
      description: 'UTC, formatted as YYYY-MM-DD HH:mm:ss',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a ServiceNow date-time string formatted as "YYYY-MM-DD HH:mm:ss" in UTC. Return ONLY the string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'endDate',
      title: 'Planned End',
      type: 'short-input',
      placeholder: '2026-01-15 11:00:00',
      condition: {
        field: 'operation',
        value: ['servicenow_create_change_request', 'servicenow_update_change_request'],
      },
      description: 'UTC, formatted as YYYY-MM-DD HH:mm:ss',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a ServiceNow date-time string formatted as "YYYY-MM-DD HH:mm:ss" in UTC. Return ONLY the string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'justification',
      title: 'Justification',
      type: 'long-input',
      placeholder: 'Why the change is needed',
      condition: { field: 'operation', value: 'servicenow_create_change_request' },
      mode: 'advanced',
    },
    {
      id: 'implementationPlan',
      title: 'Implementation Plan',
      type: 'long-input',
      placeholder: 'Steps to implement the change',
      condition: { field: 'operation', value: 'servicenow_create_change_request' },
      mode: 'advanced',
    },
    {
      id: 'backoutPlan',
      title: 'Backout Plan',
      type: 'long-input',
      placeholder: 'Steps to roll the change back',
      condition: { field: 'operation', value: 'servicenow_create_change_request' },
      mode: 'advanced',
    },
    {
      id: 'testPlan',
      title: 'Test Plan',
      type: 'long-input',
      placeholder: 'How the change is validated',
      condition: { field: 'operation', value: 'servicenow_create_change_request' },
      mode: 'advanced',
    },
    {
      id: 'changeSysId',
      title: 'Change Request sys_id',
      type: 'short-input',
      placeholder: 'sys_id of the change request',
      condition: {
        field: 'operation',
        value: ['servicenow_list_change_tasks', 'servicenow_get_change_next_states'],
      },
      required: true,
    },
    {
      id: 'order',
      title: 'Sort By',
      type: 'short-input',
      placeholder: 'number',
      condition: { field: 'operation', value: 'servicenow_list_change_tasks' },
      description: 'Field to sort the returned tasks by',
      mode: 'advanced',
    },
    // Service catalog
    {
      id: 'catalogSysId',
      title: 'Catalog sys_id',
      type: 'short-input',
      placeholder: 'Restrict to one catalog',
      condition: { field: 'operation', value: 'servicenow_list_catalog_items' },
      mode: 'advanced',
    },
    {
      id: 'categorySysId',
      title: 'Category sys_id',
      type: 'short-input',
      placeholder: 'Restrict to one category',
      condition: { field: 'operation', value: 'servicenow_list_catalog_items' },
      mode: 'advanced',
    },
    {
      id: 'catalogItemSysId',
      title: 'Catalog Item sys_id',
      type: 'short-input',
      placeholder: 'sys_id from List Catalog Items',
      condition: {
        field: 'operation',
        value: ['servicenow_order_catalog_item', 'servicenow_list_requested_items'],
      },
      required: { field: 'operation', value: 'servicenow_order_catalog_item' },
    },
    {
      id: 'quantity',
      title: 'Quantity',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'servicenow_order_catalog_item' },
    },
    {
      id: 'requestedFor',
      title: 'Requested For sys_id',
      type: 'short-input',
      placeholder: 'sys_id of the sys_user the item is for',
      condition: { field: 'operation', value: 'servicenow_order_catalog_item' },
      description:
        'Ordering on behalf of another user is governed by the glide.sc.req_for.roles instance properties.',
    },
    {
      id: 'variables',
      title: 'Item Variables (JSON)',
      type: 'code',
      language: 'json',
      placeholder: '{\n  "data_plan": "500MB"\n}',
      condition: { field: 'operation', value: 'servicenow_order_catalog_item' },
      description: 'Every variable the catalog item marks mandatory must be supplied.',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object of ServiceNow catalog item variable name-value pairs based on the request. Output ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'requestSysId',
      title: 'Request sys_id',
      type: 'short-input',
      placeholder: 'sys_id of the parent sc_request',
      condition: { field: 'operation', value: 'servicenow_list_requested_items' },
    },
    // Approvals
    {
      id: 'approverSysId',
      title: 'Approver sys_id',
      type: 'short-input',
      placeholder: 'sys_id of the sys_user',
      condition: { field: 'operation', value: 'servicenow_list_approvals' },
      description: 'Use Find User to resolve an email address to a sys_id.',
    },
    {
      id: 'approvalFor',
      title: 'Approving Record sys_id',
      type: 'short-input',
      placeholder: 'sys_id of the record being approved',
      condition: { field: 'operation', value: 'servicenow_list_approvals' },
      description: 'Matched against the sysapproval reference field.',
      mode: 'advanced',
    },
    {
      id: 'approvalSysId',
      title: 'Approval sys_id',
      type: 'short-input',
      placeholder: 'sys_id on the sysapproval_approver table',
      condition: { field: 'operation', value: 'servicenow_update_approval' },
      required: true,
    },
    {
      id: 'decision',
      title: 'Decision',
      type: 'dropdown',
      options: [...APPROVAL_DECISION_OPTIONS],
      /**
       * Deliberately unseeded. Seeding the first option defaulted the operation
       * to Approve, so `required` forces the caller to pick a decision.
       */
      condition: { field: 'operation', value: 'servicenow_update_approval' },
      required: true,
    },
    // CMDB
    {
      id: 'ciClass',
      title: 'CI Class',
      type: 'short-input',
      placeholder: 'cmdb_ci_linux_server',
      condition: {
        field: 'operation',
        value: ['servicenow_search_cis', 'servicenow_get_ci'],
      },
      required: { field: 'operation', value: 'servicenow_get_ci' },
      description: 'Read it from the sys_class_name field on a CI record.',
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Text to match in the name',
      condition: {
        field: 'operation',
        value: ['servicenow_search_cis', 'servicenow_find_user'],
      },
      description: 'LIKE match — matches anywhere in the field',
    },
    {
      id: 'operationalStatus',
      title: 'Operational Status',
      type: 'short-input',
      placeholder: 'Coded value',
      condition: { field: 'operation', value: 'servicenow_search_cis' },
      description: 'The operational_status choice list is configured per instance.',
      mode: 'advanced',
    },
    {
      id: 'ciSysId',
      title: 'Configuration Item sys_id',
      type: 'short-input',
      placeholder: 'sys_id of the CI',
      condition: { field: 'operation', value: 'servicenow_list_ci_relationships' },
      required: true,
    },
    {
      id: 'direction',
      title: 'Direction',
      type: 'dropdown',
      options: [
        { label: 'Both sides', id: 'both' },
        { label: 'CI is the parent', id: 'parent' },
        { label: 'CI is the child', id: 'child' },
      ],
      value: () => 'both',
      condition: { field: 'operation', value: 'servicenow_list_ci_relationships' },
    },
    // Knowledge
    {
      id: 'knowledgeQuery',
      title: 'Search Text',
      type: 'short-input',
      placeholder: 'vpn setup',
      condition: { field: 'operation', value: 'servicenow_search_knowledge' },
      description: 'Text searched across knowledge articles',
    },
    {
      id: 'filter',
      title: 'Article Filter',
      type: 'short-input',
      placeholder: 'workflow_state=published',
      condition: { field: 'operation', value: 'servicenow_search_knowledge' },
      description: 'Encoded query against the Knowledge [kb_knowledge] table',
      mode: 'advanced',
    },
    {
      id: 'knowledgeBaseSysIds',
      title: 'Knowledge Base sys_ids',
      type: 'short-input',
      placeholder: 'Comma-separated kb_knowledge_base sys_ids',
      condition: { field: 'operation', value: 'servicenow_search_knowledge' },
      mode: 'advanced',
    },
    {
      id: 'language',
      title: 'Language',
      type: 'short-input',
      placeholder: 'en',
      condition: {
        field: 'operation',
        value: ['servicenow_search_knowledge', 'servicenow_get_knowledge_article'],
      },
      description: 'ISO 639-1 language codes, or "all" when searching',
      mode: 'advanced',
    },
    {
      id: 'articleId',
      title: 'Article sys_id or KB Number',
      type: 'short-input',
      placeholder: 'KB0000011',
      condition: { field: 'operation', value: 'servicenow_get_knowledge_article' },
      required: true,
    },
    {
      id: 'updateView',
      title: 'Count as a View',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'servicenow_get_knowledge_article' },
      description: 'Increments the view count and records an entry in Knowledge Use [kb_use].',
      mode: 'advanced',
    },
    // Users and groups
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'user@example.com',
      condition: { field: 'operation', value: 'servicenow_find_user' },
      description: 'Exact match',
    },
    {
      id: 'userName',
      title: 'User Name',
      type: 'short-input',
      placeholder: 'abel.tuter',
      condition: { field: 'operation', value: 'servicenow_find_user' },
      description: 'Exact match on the user_name field',
    },
    {
      id: 'groupSysId',
      title: 'Group sys_id',
      type: 'short-input',
      placeholder: 'sys_id of the sys_user_group',
      condition: { field: 'operation', value: 'servicenow_list_group_members' },
    },
    {
      id: 'groupName',
      title: 'Group Name',
      type: 'short-input',
      placeholder: 'Network',
      condition: { field: 'operation', value: 'servicenow_list_group_members' },
      description: 'Exact group name. Provide this or the group sys_id.',
    },
    // Shared write controls
    {
      id: 'additionalFields',
      title: 'Additional Fields (JSON)',
      type: 'code',
      language: 'json',
      placeholder: '{\n  "correlation_id": "abc-123"\n}',
      condition: { field: 'operation', value: [...ADDITIONAL_FIELDS_OPS] },
      description:
        'Raw ServiceNow column names for anything not covered above. Merged last, so it overrides the fields set here.',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object of raw ServiceNow column names and values for the target table. Output ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'inputDisplayValue',
      title: 'Write Display Names',
      type: 'dropdown',
      options: [
        { label: 'No — reference fields are sys_ids', id: 'false' },
        { label: 'Yes — resolve display names to sys_ids', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: [...SEMANTIC_WRITE_PARAM_OPS] },
      description:
        'Sets sysparm_input_display_value, letting you write "Beth Anglin" into assigned_to instead of a sys_id. Also reinterprets date and time values in your timezone rather than GMT.',
      mode: 'advanced',
    },
    ...getTrigger('servicenow_incident_created').subBlocks,
    ...getTrigger('servicenow_incident_updated').subBlocks,
    ...getTrigger('servicenow_change_request_created').subBlocks,
    ...getTrigger('servicenow_change_request_updated').subBlocks,
    ...getTrigger('servicenow_webhook').subBlocks,
  ],
  tools: {
    access: [
      'servicenow_create_record',
      'servicenow_read_record',
      'servicenow_update_record',
      'servicenow_delete_record',
      'servicenow_aggregate',
      'servicenow_list_attachments',
      'servicenow_download_attachment',
      'servicenow_upload_attachment',
      'servicenow_create_incident',
      'servicenow_get_incident',
      'servicenow_list_incidents',
      'servicenow_update_incident',
      'servicenow_resolve_incident',
      'servicenow_close_incident',
      'servicenow_add_incident_comment',
      'servicenow_create_change_request',
      'servicenow_get_change_request',
      'servicenow_list_change_requests',
      'servicenow_update_change_request',
      'servicenow_update_change_state',
      'servicenow_list_change_tasks',
      'servicenow_get_change_next_states',
      'servicenow_list_catalog_items',
      'servicenow_order_catalog_item',
      'servicenow_list_requested_items',
      'servicenow_get_requested_item',
      'servicenow_list_approvals',
      'servicenow_update_approval',
      'servicenow_search_cis',
      'servicenow_get_ci',
      'servicenow_list_ci_relationships',
      'servicenow_search_knowledge',
      'servicenow_get_knowledge_article',
      'servicenow_find_user',
      'servicenow_list_group_members',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const {
          operation,
          fields,
          readFields,
          returnFields,
          file,
          attachmentLimit,
          semanticDisplayValue,
          targetState,
          approvalState,
          incidentState,
          changeState,
          incidentComments,
          approvalComments,
          resolutionCode,
          changeCloseCode,
          resolutionNotes,
          changeCloseNotes,
          knowledgeQuery,
          ...rest
        } = params
        const isCreateOrUpdate =
          operation === 'servicenow_create_record' || operation === 'servicenow_update_record'

        if (SEMANTIC_DISPLAY_VALUE_OPS.has(operation)) {
          rest.displayValue = semanticDisplayValue
        }

        /**
         * Subblock values are stored per block keyed by subblock id, so an id
         * reused across operations carries one value between them. Each of these
         * tool params has more than one value space — an incident `state` is not
         * a change `state`, and a knowledge search phrase is not an encoded
         * query — so each gets its own subblock and is republished here for the
         * operations that own it. Assign explicitly rather than conditionally:
         * `finalInputs` merges this result over the raw inputs, so a key left
         * off is not dropped, it keeps whatever the raw input held.
         */
        const stateSource =
          operation === 'servicenow_update_change_state'
            ? targetState
            : operation === 'servicenow_list_approvals'
              ? approvalState
              : CHANGE_STATE_OPS.has(operation)
                ? changeState
                : incidentState
        rest.state = SEMANTIC_STATE_OPS.has(operation) ? stateSource : undefined
        rest.comments =
          operation === 'servicenow_update_approval' ? approvalComments : incidentComments
        rest.closeCode = CHANGE_CLOSE_OPS.has(operation) ? changeCloseCode : resolutionCode
        rest.closeNotes = CHANGE_CLOSE_OPS.has(operation) ? changeCloseNotes : resolutionNotes
        if (operation === 'servicenow_search_knowledge') rest.query = knowledgeQuery

        /**
         * `attachmentLimit` exists as a separate subblock precisely so a limit
         * typed on one operation cannot leak into another, but neither branch
         * used to be scoped, so whichever ran last won: List Incidents took a
         * stale `attachmentLimit`, and List Attachments took a stale `limit`.
         * Every paginated operation reads exactly one of the two.
         */
        if (operation === 'servicenow_list_attachments') {
          rest.limit =
            attachmentLimit != null && attachmentLimit !== '' ? Number(attachmentLimit) : undefined
        } else if (rest.limit != null) {
          rest.limit = rest.limit === '' ? undefined : Number(rest.limit)
        }
        /**
         * A short-input stores `''` once a user types a value and clears it
         * again, so a blank must resolve to `undefined` rather than stay in
         * place — the tools only skip a param that is absent, and a retained
         * `''` reaches ServiceNow as `sysparm_limit=`.
         */
        if (rest.offset != null) rest.offset = rest.offset === '' ? undefined : Number(rest.offset)
        if (rest.quantity != null) {
          rest.quantity = rest.quantity === '' ? undefined : Number(rest.quantity)
        }

        if (rest.inputDisplayValue != null) {
          rest.inputDisplayValue =
            rest.inputDisplayValue === true || rest.inputDisplayValue === 'true'
        }
        if (rest.updateView != null) {
          rest.updateView = rest.updateView === true || rest.updateView === 'true'
        }

        for (const [key, label] of JSON_SUBBLOCKS) {
          const value = rest[key]
          if (typeof value === 'string') {
            const trimmed = value.trim()
            rest[key] = trimmed ? parseJsonSubBlock(trimmed, label) : undefined
          }
        }

        if (operation === 'servicenow_aggregate') {
          rest.count = rest.count === true || rest.count === 'true'
        }

        if (operation === 'servicenow_upload_attachment') {
          const normalizedFile = normalizeFileInput(file, { single: true })
          return normalizedFile ? { ...rest, file: normalizedFile } : rest
        }

        /**
         * The `fields` tool param means two different things: a JSON body on
         * Create/Update Record, and a comma-separated projection everywhere
         * else. Every subblock therefore owns exactly one of those value
         * spaces — `fields` is the Create/Update body, `readFields` is Read
         * Records' projection, `returnFields` is every other operation's — so a
         * JSON body can never arrive as a projection or the reverse.
         */
        if (isCreateOrUpdate) {
          if (!fields) return { ...rest, fields: undefined }
          const parsedFields =
            typeof fields === 'string' ? parseJsonSubBlock(fields, 'Fields') : fields
          return { ...rest, fields: parsedFields }
        }

        const projection = operation === 'servicenow_read_record' ? readFields : returnFields
        return { ...rest, fields: projection || undefined }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    instanceUrl: { type: 'string', description: 'ServiceNow instance URL' },
    username: { type: 'string', description: 'ServiceNow username' },
    password: { type: 'string', description: 'ServiceNow password' },
    tableName: { type: 'string', description: 'Table name' },
    sysId: { type: 'string', description: 'Record sys_id' },
    number: { type: 'string', description: 'Record number' },
    query: { type: 'string', description: 'Query string' },
    limit: { type: 'number', description: 'Result limit' },
    attachmentLimit: {
      type: 'number',
      description: 'Max attachments to return (list attachments)',
    },
    offset: { type: 'number', description: 'Pagination offset' },
    fields: { type: 'json', description: 'Fields object or JSON string' },
    readFields: {
      type: 'string',
      description: 'Comma-separated fields to return (Read Records)',
    },
    displayValue: { type: 'string', description: 'Display value mode for reference fields' },
    semanticDisplayValue: {
      type: 'string',
      description: 'Display value mode for the semantic operations, defaulting to "all"',
    },
    count: { type: 'boolean', description: 'Return record count (aggregate)' },
    groupBy: { type: 'string', description: 'Comma-separated fields to group by (aggregate)' },
    avgFields: { type: 'string', description: 'Comma-separated fields to average (aggregate)' },
    sumFields: { type: 'string', description: 'Comma-separated fields to sum (aggregate)' },
    minFields: { type: 'string', description: 'Comma-separated fields to minimize (aggregate)' },
    maxFields: { type: 'string', description: 'Comma-separated fields to maximize (aggregate)' },
    having: { type: 'string', description: 'Aggregate result filter (aggregate)' },
    recordSysId: { type: 'string', description: 'Record sys_id for attachment operations' },
    attachmentSysId: { type: 'string', description: 'Attachment sys_id to download' },
    fileName: { type: 'string', description: 'Name of the file to upload' },
    file: { type: 'json', description: 'File to upload (canonical param)' },
    shortDescription: { type: 'string', description: 'Short description of the record' },
    description: { type: 'string', description: 'Detailed description of the record' },
    searchText: { type: 'string', description: 'Text matched against the short description' },
    state: { type: 'string', description: 'State coded value' },
    targetState: { type: 'string', description: 'Target state for a change request transition' },
    approvalState: { type: 'string', description: 'Approval state filter' },
    incidentState: { type: 'string', description: 'Incident state coded value' },
    changeState: { type: 'string', description: 'Change request state coded value' },
    incidentComments: { type: 'string', description: 'Customer-visible incident comment' },
    approvalComments: { type: 'string', description: 'Comment recorded with an approval decision' },
    resolutionCode: { type: 'string', description: 'Incident resolution (close) code' },
    changeCloseCode: { type: 'string', description: 'Change request close code' },
    resolutionNotes: { type: 'string', description: 'Incident resolution notes' },
    changeCloseNotes: { type: 'string', description: 'Change request close notes' },
    knowledgeQuery: { type: 'string', description: 'Knowledge article search text' },
    returnFields: { type: 'string', description: 'Comma-separated fields to return' },
    impact: { type: 'string', description: 'Impact coded value' },
    urgency: { type: 'string', description: 'Urgency coded value' },
    priority: { type: 'string', description: 'Priority coded value' },
    category: { type: 'string', description: 'Category' },
    subcategory: { type: 'string', description: 'Subcategory' },
    contactType: { type: 'string', description: 'Channel the record came in on' },
    callerId: { type: 'string', description: 'sys_id of the caller' },
    assignmentGroup: { type: 'string', description: 'sys_id of the assignment group' },
    assignedTo: { type: 'string', description: 'sys_id of the assigned user' },
    cmdbCi: { type: 'string', description: 'sys_id of the affected configuration item' },
    businessService: { type: 'string', description: 'sys_id of the affected business service' },
    requestedBy: { type: 'string', description: 'sys_id of the requesting user' },
    active: { type: 'string', description: 'Active filter ("true" or "false")' },
    workNotes: { type: 'string', description: 'Internal work note' },
    comments: { type: 'string', description: 'Customer-visible comment or approval comment' },
    comment: { type: 'string', description: 'Text appended to an incident journal field' },
    commentField: { type: 'string', description: 'Journal field to append to' },
    closeCode: { type: 'string', description: 'Resolution or close code' },
    closeNotes: { type: 'string', description: 'Resolution or close notes' },
    type: { type: 'string', description: 'Change request type' },
    risk: { type: 'string', description: 'Change risk coded value' },
    startDate: { type: 'string', description: 'Planned start date' },
    endDate: { type: 'string', description: 'Planned end date' },
    justification: { type: 'string', description: 'Change justification' },
    implementationPlan: { type: 'string', description: 'Change implementation plan' },
    backoutPlan: { type: 'string', description: 'Change backout plan' },
    testPlan: { type: 'string', description: 'Change test plan' },
    changeSysId: { type: 'string', description: 'sys_id of the change request' },
    order: { type: 'string', description: 'Field to sort change tasks by' },
    catalogSysId: { type: 'string', description: 'sys_id of the catalog' },
    categorySysId: { type: 'string', description: 'sys_id of the catalog category' },
    catalogItemSysId: { type: 'string', description: 'sys_id of the catalog item' },
    quantity: { type: 'number', description: 'Quantity to order' },
    requestedFor: { type: 'string', description: 'sys_id of the user the item is ordered for' },
    variables: { type: 'json', description: 'Catalog item variable name-value pairs' },
    requestSysId: { type: 'string', description: 'sys_id of the parent request' },
    approverSysId: { type: 'string', description: 'sys_id of the approver' },
    approvalFor: { type: 'string', description: 'sys_id of the record being approved' },
    approvalSysId: { type: 'string', description: 'sys_id of the approval record' },
    decision: { type: 'string', description: 'Approval decision' },
    ciClass: { type: 'string', description: 'CMDB class name' },
    name: { type: 'string', description: 'Name filter' },
    operationalStatus: { type: 'string', description: 'CI operational status coded value' },
    ciSysId: { type: 'string', description: 'sys_id of the configuration item' },
    direction: { type: 'string', description: 'Relationship direction to match' },
    filter: { type: 'string', description: 'Knowledge article encoded query filter' },
    knowledgeBaseSysIds: { type: 'string', description: 'Knowledge base sys_ids to search' },
    language: { type: 'string', description: 'ISO 639-1 language codes' },
    articleId: { type: 'string', description: 'Knowledge article sys_id or KB number' },
    updateView: { type: 'boolean', description: 'Whether to count the read as an article view' },
    email: { type: 'string', description: 'User email address' },
    userName: { type: 'string', description: 'ServiceNow user name' },
    groupSysId: { type: 'string', description: 'sys_id of the group' },
    groupName: { type: 'string', description: 'Group name' },
    additionalFields: { type: 'json', description: 'Extra raw ServiceNow fields to write' },
    inputDisplayValue: {
      type: 'boolean',
      description: 'Whether input values are treated as display values',
    },
  },
  outputs: {
    record: { type: 'json', description: 'Single ServiceNow record' },
    records: { type: 'json', description: 'Array of ServiceNow records' },
    success: { type: 'boolean', description: 'Operation success status' },
    metadata: { type: 'json', description: 'Operation metadata' },
    result: { type: 'json', description: 'Aggregate result (stats or grouped array)' },
    count: { type: 'number', description: 'Aggregate matching record count' },
    attachments: {
      type: 'json',
      description:
        'Attachment metadata list — record attachments (sys_id, file_name, content_type, download_link) or knowledge article attachments (sys_id, file_name, size_bytes, state)',
    },
    file: { type: 'file', description: 'Downloaded attachment file' },
    content: {
      type: 'string',
      description:
        'Base64-encoded downloaded file content, or the HTML body of a knowledge article',
    },
    attachment: { type: 'json', description: 'Uploaded attachment metadata' },
    tasks: {
      type: 'json',
      description:
        'Change tasks belonging to a change request. Unlike the Table API operations, the Change Management API always returns every field as {value, display_value} regardless of the display value setting',
    },
    items: { type: 'json', description: 'Service catalog items' },
    articles: { type: 'json', description: 'Knowledge article search results' },
    attributes: { type: 'json', description: 'Configuration item attributes' },
    inboundRelations: { type: 'json', description: 'Inbound CI relationships' },
    outboundRelations: { type: 'json', description: 'Outbound CI relationships' },
    sysId: { type: 'string', description: 'sys_id returned by the operation' },
    number: { type: 'string', description: 'Record number returned by the operation' },
    requestNumber: { type: 'string', description: 'Catalog request number' },
    requestId: { type: 'string', description: 'sys_id of the catalog request' },
    table: { type: 'string', description: 'Table the catalog request was created on' },
    availableStates: {
      type: 'json',
      description: 'State coded values a change request can reach, including its current state',
    },
    allowedStates: {
      type: 'json',
      description:
        'State coded values whose transition conditions the change request already meets',
    },
    stateLabels: {
      type: 'json',
      description: "This instance's own map of state coded value to label, e.g. {'0': 'Review'}",
    },
    stateTransitions: {
      type: 'json',
      description:
        '[{sys_id, display_value, from_state, to_state, transition_available, automatic_transition, conditions}]',
    },
    title: { type: 'string', description: 'Knowledge article title' },
    fields: { type: 'json', description: 'Requested knowledge article field values' },
  },
  triggers: {
    enabled: true,
    available: [
      'servicenow_incident_created',
      'servicenow_incident_updated',
      'servicenow_change_request_created',
      'servicenow_change_request_updated',
      'servicenow_webhook',
    ],
  },
}

export const ServiceNowBlockMeta = {
  tags: ['customer-support', 'ticketing', 'incident-management'],
  url: 'https://www.servicenow.com',
  templates: [
    {
      icon: ServiceNowIcon,
      title: 'ServiceNow incident commander',
      prompt:
        'Build a workflow triggered when a ServiceNow incident is created at P1 or P2 that opens a Slack war-room channel, posts the incident description and impacted CI, invites the assignment group, and keeps the channel topic in sync with the incident state.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'automation', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ServiceNowIcon,
      title: 'ServiceNow change request analyzer',
      prompt:
        'Create a workflow that reads new ServiceNow change requests, scores risk based on affected services, blackout windows, and change history, and updates the change record with a recommended approver chain and a risk justification note.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'analysis', 'devops'],
    },
    {
      icon: ServiceNowIcon,
      title: 'ServiceNow knowledge sync',
      prompt:
        'Build a scheduled workflow that pulls Confluence pages tagged for IT operations and creates or updates matching ServiceNow knowledge articles, mapping categories and authors so the knowledge base stays in sync without manual copy-paste.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'sync', 'team'],
      alsoIntegrations: ['confluence'],
    },
    {
      icon: ServiceNowIcon,
      title: 'ServiceNow asset audit',
      prompt:
        'Create a scheduled workflow that queries the ServiceNow CMDB for assets missing owner, lifecycle, or last-discovered fields, flags stale or orphaned records in a tracking table, and opens remediation tasks against the responsible group.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring', 'analysis'],
    },
    {
      icon: ServiceNowIcon,
      title: 'ServiceNow ticket auto-classifier',
      prompt:
        'Build a workflow triggered by new ServiceNow incidents that classifies category and subcategory, sets impact and urgency, infers the affected service from the description, and routes the ticket to the right assignment group.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation', 'support'],
    },
    {
      icon: ServiceNowIcon,
      title: 'ServiceNow weekly ops digest',
      prompt:
        'Create a scheduled weekly workflow that pulls ServiceNow incident, change, and request data, calculates MTTR, change success rate, and top failing services, and posts a digest to Slack with the standout records linked.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'reporting', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ServiceNowIcon,
      title: 'ServiceNow ticket deflection bot',
      prompt:
        'Build a Slack bot that lets employees report IT issues in natural language, reads similar resolved ServiceNow records to suggest a fix first, and only creates a new ServiceNow incident record with the right category when self-service does not resolve it.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'create-incident',
      description: 'File a ServiceNow incident with the right category, priority, and description.',
      content:
        '# Create Incident\n\nFile a new ServiceNow incident from a reported issue.\n\n## Steps\n1. Use the Create Incident operation. It targets the incident table for you — do not reach for the generic Create Record operation, which makes you name the table and hand-build the field payload.\n2. Set a clear short description, the longer description, and the category.\n3. Set priority through impact and urgency rather than writing priority directly; ServiceNow derives priority from those two and overwrites a directly written value.\n4. Set the caller and assignment group when they are known.\n\n## Output\nReturn the created sys_id and incident number so the reporter can track it, and echo the category and the derived priority.',
    },
    {
      name: 'triage-incidents',
      description:
        'Find the ServiceNow incidents matching a state, priority, or assignment and summarize them.',
      content:
        '# Triage Incidents\n\nPull the incidents that need attention and summarize them.\n\n## Steps\n1. Use the List Incidents operation with the filters it exposes — state, priority, assignment group, or an encoded query for anything else. Reserve the generic Read Records operation for tables that have no semantic operation of their own.\n2. Always set the limit. Nothing sends one for you, and the ServiceNow Table API falls back to its own default of 10,000 records, so an unset limit pulls far more than you will read.\n3. Keep the display-value setting at "all" so reference fields come back with both their sys_id and a human-readable label.\n4. Read a single incident in full with Get Incident once you have picked one out.\n\n## Output\nSummarize the matched incidents by number, short description, state, and priority, and say how many matched.',
    },
    {
      name: 'progress-incident',
      description:
        'Move a ServiceNow incident forward — comment on it, update fields, resolve it, or close it.',
      content:
        '# Progress an Incident\n\nAdvance an incident once work has happened on it.\n\n## Steps\n1. Identify the incident by number or sys_id, from List Incidents or from the trigger payload.\n2. Pick the operation that matches the action: Add Incident Comment for a note, Update Incident for field changes, Resolve Incident when a fix is in place, Close Incident to finish it.\n3. Resolve Incident requires a close code and close notes — ServiceNow rejects a resolution without them.\n4. When commenting, choose the journal field deliberately: work notes are internal, additional comments are visible to the caller.\n\n## Output\nConfirm the incident number, which operation ran, and the resulting state so the update is auditable.',
    },
    {
      name: 'manage-change-request',
      description:
        'Raise a ServiceNow change request and drive it through its approval state machine.',
      content:
        '# Manage a Change Request\n\nRaise a change and move it through its lifecycle.\n\n## Steps\n1. Use Create Change Request, choosing the type — normal, standard, or emergency — that matches the risk. Standard changes are pre-approved; emergency changes skip the usual review.\n2. Use Update Change Request for field edits such as the plans, schedule, or assignment group.\n3. Do not write the state field directly. Call Get Change Next States first to learn which transitions the state machine currently permits, then Move Change State to take one — the machine rejects a transition whose conditions have not been met, and the error will not say which condition failed.\n4. Use List Change Tasks to see the work items under the change.\n\n## Output\nReport the change number, its current state, and the transitions that are still available from here.',
    },
    {
      name: 'order-catalog-item',
      description: 'Order a ServiceNow catalog item and track the requested item it produces.',
      content:
        '# Order a Catalog Item\n\nSubmit a service catalog request on behalf of a requester.\n\n## Steps\n1. Use List Catalog Items to find the item and its sys_id; ordering needs the sys_id, not the display name.\n2. Use Order Catalog Item with that sys_id, the quantity, and the item variables. Variables are item-specific — read them off the catalog item rather than assuming a shape.\n3. Track the result with List Requested Items or Get Requested Item, which is where the fulfillment state lives.\n\n## Output\nReturn the request number, the requested-item number, and the current fulfillment state.',
    },
    {
      name: 'handle-approvals',
      description: 'Find pending ServiceNow approvals and record an approve or reject decision.',
      content:
        '# Handle Approvals\n\nWork the approval queue.\n\n## Steps\n1. Use List Approvals filtered by state. The pending state is `requested`; the state values are not uniformly punctuated — `not requested` has a space while `not_required` has an underscore — so pick from the offered list instead of typing one.\n2. Read what is being approved before deciding. The approval record points at a source record; fetch it with Get Change Request or Get Requested Item.\n3. Use Approve or Reject to record the decision. Only those two are writable here — every other approval state is set by the approval engine, not by an approver.\n4. Include a comment explaining the decision when the process expects a justification.\n\n## Output\nConfirm which approval record was acted on, the decision recorded, and what it unblocks.',
    },
    {
      name: 'investigate-cmdb',
      description:
        'Look up a ServiceNow configuration item and map what it depends on and what depends on it.',
      content:
        '# Investigate the CMDB\n\nEstablish blast radius before a change or during an incident.\n\n## Steps\n1. Use Search Configuration Items to locate the CI by name or class, then Get Configuration Item for its full record.\n2. Use List CI Relationships to walk the dependency graph. Choose the direction deliberately: parents are what this CI depends on, children are what depends on it, and impact analysis usually wants the children.\n3. Follow the graph outward one hop at a time rather than pulling everything at once — CMDB relationship sets grow quickly.\n\n## Output\nName the CI, its class and operational status, and list the dependent CIs a change to it would affect.',
    },
    {
      name: 'search-knowledge',
      description: 'Search the ServiceNow knowledge base for an existing fix before escalating.',
      content:
        '# Search Knowledge\n\nCheck whether a documented fix already exists.\n\n## Steps\n1. Use Search Knowledge with the wording the reporter used; the search runs over article text, so their own phrasing usually matches better than a normalized restatement.\n2. Use Get Knowledge Article to pull the full body of a promising hit — the search result carries only a snippet.\n3. Prefer this before Create Incident when the issue looks routine; a linked article often resolves it outright.\n\n## Output\nCite the article number and title, summarize the fix, and say plainly if nothing relevant was found so the caller escalates instead of guessing.',
    },
  ],
} as const satisfies BlockMeta
