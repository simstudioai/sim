import { CrowdStrikeIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import {
  parseOptionalBooleanInput,
  parseOptionalJsonInput,
  parseOptionalNumberInput,
} from '@/blocks/utils'
import type { CrowdStrikeResponse } from '@/tools/crowdstrike/types'

/**
 * Maximum `limit` for each CrowdStrike query collection. Every entry except IOC
 * Management is the `maximum` CrowdStrike publishes in its swagger. The IOC
 * indicators endpoint publishes no `maximum` at all, so 500 is a Sim cap chosen
 * to keep a single request bounded — do not describe it as CrowdStrike's.
 */
const QUERY_LIMITS: Record<string, { min: number; max: number }> = {
  crowdstrike_query_sensors: { min: 1, max: 200 },
  crowdstrike_query_alerts: { min: 1, max: 10000 },
  crowdstrike_query_host_groups: { min: 1, max: 5000 },
  crowdstrike_query_indicators: { min: 1, max: 500 },
  crowdstrike_query_vulnerabilities: { min: 1, max: 400 },
  crowdstrike_query_cases: { min: 1, max: 10000 },
}

/** Spotlight paginates by cursor only, so it accepts no `offset`. */
const OFFSET_QUERY_OPERATIONS = new Set([
  'crowdstrike_query_sensors',
  'crowdstrike_query_alerts',
  'crowdstrike_query_host_groups',
  'crowdstrike_query_indicators',
  'crowdstrike_query_cases',
])

/** Only the IOC and Spotlight query endpoints accept an `after` cursor. */
const CURSOR_QUERY_OPERATIONS = new Set([
  'crowdstrike_query_indicators',
  'crowdstrike_query_vulnerabilities',
])

/** Only Alerts and Case Management accept the free-text `q` parameter. */
const FREE_TEXT_QUERY_OPERATIONS = new Set(['crowdstrike_query_alerts', 'crowdstrike_query_cases'])

/**
 * Every optional request key the block can produce, pre-cleared to `undefined`.
 * The executor merges the mapped params over the raw block inputs, so a key left
 * out of the mapped result silently keeps its raw subBlock value.
 */
const CLEARED_OPTIONAL_PARAMS: Record<string, undefined> = Object.freeze({
  actionName: undefined,
  actionParameters: undefined,
  addTag: undefined,
  after: undefined,
  aggregateQuery: undefined,
  appendComment: undefined,
  assignToName: undefined,
  assignToUserId: undefined,
  assignToUuid: undefined,
  baseCommand: undefined,
  caseIds: undefined,
  cloudRequestId: undefined,
  commandString: undefined,
  comment: undefined,
  compositeIds: undefined,
  deleteFilter: undefined,
  deviceId: undefined,
  deviceIds: undefined,
  filter: undefined,
  hostActionName: undefined,
  hostGroupActionName: undefined,
  hostGroupId: undefined,
  hostGroupIds: undefined,
  ids: undefined,
  ignoreWarnings: undefined,
  includeHidden: undefined,
  indicatorIds: undefined,
  indicators: undefined,
  limit: undefined,
  offset: undefined,
  origin: undefined,
  q: undefined,
  queueOffline: undefined,
  removeTag: undefined,
  removeTagsByPrefix: undefined,
  retrodetects: undefined,
  sequenceId: undefined,
  sessionId: undefined,
  showInUi: undefined,
  sort: undefined,
  unassign: undefined,
  updateStatus: undefined,
  vulnerabilityIds: undefined,
})

export const CrowdStrikeBlock: BlockConfig<CrowdStrikeResponse> = {
  type: 'crowdstrike',
  name: 'CrowdStrike',
  description:
    'Investigate and respond to CrowdStrike Falcon alerts, hosts, IOCs, and vulnerabilities',
  longDescription:
    'Integrate CrowdStrike Falcon into workflows to triage alerts, contain hosts, manage host groups and custom indicators of compromise, review Spotlight vulnerabilities, run read-only Real Time Response commands, read Case Management cases, and query Identity Protection sensors.',
  docsLink: 'https://docs.sim.ai/integrations/crowdstrike',
  category: 'tools',
  integrationType: IntegrationType.Security,
  bgColor: '#E01F3D',
  iconColor: '#E01F3D',
  icon: CrowdStrikeIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'CrowdStrike',
    sentences: {
      byOperation: {
        crowdstrike_query_sensors: [
          'Search identity sensors',
          { text: ', where', field: 'filter' },
          { text: ', sorted by', field: 'sort' },
          { text: ', up to', field: 'limit', after: 'results' },
        ],
        crowdstrike_get_sensor_details: [
          { text: 'Fetch sensor details for', field: 'ids', core: true },
        ],
        crowdstrike_get_sensor_aggregates: [
          { text: 'Aggregate sensors with', field: 'aggregateQuery', core: true },
        ],
        crowdstrike_query_alerts: [
          'Search Falcon alerts',
          { text: ', where', field: 'filter' },
          { text: ', matching', field: 'q' },
          { text: ', sorted by', field: 'sort' },
          { text: ', up to', field: 'limit', after: 'results' },
        ],
        crowdstrike_get_alert_details: [
          { text: 'Fetch alert details for', field: 'compositeIds', core: true },
        ],
        crowdstrike_update_alerts: [
          { text: 'Update alerts', field: 'compositeIds', core: true },
          { text: ', setting status to', field: 'updateStatus' },
          { text: ', assigning to', field: 'assignToUuid' },
          { text: ', commenting', field: 'appendComment' },
        ],
        crowdstrike_perform_host_action: [
          { text: 'Run', field: 'hostActionName', core: true },
          { text: 'on hosts', field: 'deviceIds', core: true },
        ],
        crowdstrike_query_host_groups: [
          'Search host groups',
          { text: ', where', field: 'filter' },
          { text: ', sorted by', field: 'sort' },
          { text: ', up to', field: 'limit', after: 'results' },
        ],
        crowdstrike_get_host_group_details: [
          { text: 'Fetch host group details for', field: 'hostGroupIds', core: true },
        ],
        crowdstrike_perform_host_group_action: [
          { text: 'Run', field: 'hostGroupActionName', core: true },
          { text: 'on group', field: 'hostGroupId', core: true },
          { text: 'for hosts', field: 'deviceIds' },
        ],
        crowdstrike_query_indicators: [
          'Search custom indicators',
          { text: ', where', field: 'filter' },
          { text: ', sorted by', field: 'sort' },
          { text: ', up to', field: 'limit', after: 'results' },
        ],
        crowdstrike_get_indicator_details: [
          { text: 'Fetch indicator details for', field: 'indicatorIds', core: true },
        ],
        crowdstrike_create_indicators: [
          { text: 'Create indicators', field: 'indicators', core: true },
          { text: ', noting', field: 'comment' },
        ],
        crowdstrike_update_indicators: [
          { text: 'Update indicators', field: 'indicators', core: true },
          { text: ', noting', field: 'comment' },
        ],
        crowdstrike_delete_indicators: [
          'Delete custom indicators',
          { text: 'with IDs', field: 'indicatorIds' },
          { text: ', matching', field: 'deleteFilter' },
          { text: ', noting', field: 'comment' },
        ],
        crowdstrike_query_vulnerabilities: [
          { text: 'Search Spotlight vulnerabilities where', field: 'filter', core: true },
          { text: ', sorted by', field: 'sort' },
          { text: ', up to', field: 'limit', after: 'results' },
        ],
        crowdstrike_get_vulnerability_details: [
          { text: 'Fetch vulnerability details for', field: 'vulnerabilityIds', core: true },
        ],
        crowdstrike_init_rtr_session: [
          { text: 'Open a Real Time Response session on', field: 'deviceId', core: true },
        ],
        crowdstrike_execute_rtr_command: [
          { text: 'Run', field: 'commandString', core: true },
          { text: 'in session', field: 'sessionId', core: true },
        ],
        crowdstrike_get_rtr_command_status: [
          { text: 'Check command', field: 'cloudRequestId', core: true },
          { text: ', chunk', field: 'sequenceId' },
        ],
        crowdstrike_delete_rtr_session: [
          { text: 'Close Real Time Response session', field: 'sessionId', core: true },
        ],
        crowdstrike_query_cases: [
          'Search cases',
          { text: ', where', field: 'filter' },
          { text: ', matching', field: 'q' },
          { text: ', sorted by', field: 'sort' },
          { text: ', up to', field: 'limit', after: 'results' },
        ],
        crowdstrike_get_case_details: [
          { text: 'Fetch case details for', field: 'caseIds', core: true },
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
        { label: 'Query Alerts', id: 'crowdstrike_query_alerts' },
        { label: 'Get Alert Details', id: 'crowdstrike_get_alert_details' },
        { label: 'Update Alerts', id: 'crowdstrike_update_alerts' },
        { label: 'Perform Host Action', id: 'crowdstrike_perform_host_action' },
        { label: 'Query Host Groups', id: 'crowdstrike_query_host_groups' },
        { label: 'Get Host Group Details', id: 'crowdstrike_get_host_group_details' },
        { label: 'Perform Host Group Action', id: 'crowdstrike_perform_host_group_action' },
        { label: 'Query Indicators', id: 'crowdstrike_query_indicators' },
        { label: 'Get Indicator Details', id: 'crowdstrike_get_indicator_details' },
        { label: 'Create Indicators', id: 'crowdstrike_create_indicators' },
        { label: 'Update Indicators', id: 'crowdstrike_update_indicators' },
        { label: 'Delete Indicators', id: 'crowdstrike_delete_indicators' },
        { label: 'Query Vulnerabilities', id: 'crowdstrike_query_vulnerabilities' },
        { label: 'Get Vulnerability Details', id: 'crowdstrike_get_vulnerability_details' },
        { label: 'Init RTR Session', id: 'crowdstrike_init_rtr_session' },
        { label: 'Execute RTR Command', id: 'crowdstrike_execute_rtr_command' },
        { label: 'Get RTR Command Status', id: 'crowdstrike_get_rtr_command_status' },
        { label: 'Delete RTR Session', id: 'crowdstrike_delete_rtr_session' },
        { label: 'Query Cases', id: 'crowdstrike_query_cases' },
        { label: 'Get Case Details', id: 'crowdstrike_get_case_details' },
        { label: 'Query Sensors', id: 'crowdstrike_query_sensors' },
        { label: 'Get Sensor Details', id: 'crowdstrike_get_sensor_details' },
        { label: 'Get Sensor Aggregates', id: 'crowdstrike_get_sensor_aggregates' },
      ],
      value: () => 'crowdstrike_query_alerts',
      required: true,
    },
    {
      id: 'clientId',
      title: 'Client ID',
      type: 'short-input',
      placeholder: 'CrowdStrike Falcon API client ID',
      required: true,
    },
    {
      id: 'clientSecret',
      title: 'Client Secret',
      type: 'short-input',
      password: true,
      placeholder: 'CrowdStrike Falcon API client secret',
      required: true,
    },
    {
      id: 'cloud',
      title: 'Cloud Region',
      type: 'dropdown',
      options: [
        { label: 'US-1', id: 'us-1' },
        { label: 'US-2', id: 'us-2' },
        { label: 'US-3', id: 'us-3' },
        { label: 'EU-1', id: 'eu-1' },
        { label: 'US-GOV-1', id: 'us-gov-1' },
        { label: 'US-GOV-2', id: 'us-gov-2' },
      ],
      value: () => 'us-1',
      required: true,
    },
    {
      id: 'filter',
      title: 'Filter',
      type: 'short-input',
      placeholder: 'status:"new"+severity:>70',
      condition: {
        field: 'operation',
        value: [
          'crowdstrike_query_sensors',
          'crowdstrike_query_alerts',
          'crowdstrike_query_host_groups',
          'crowdstrike_query_indicators',
          'crowdstrike_query_vulnerabilities',
          'crowdstrike_query_cases',
        ],
      },
      required: { field: 'operation', value: 'crowdstrike_query_vulnerabilities' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a CrowdStrike Falcon Query Language (FQL) filter string for the selected CrowdStrike collection. Use exact field names, operators, and values only. Return ONLY the filter string - no explanations, no extra text.',
        placeholder:
          'Describe what you want to match, for example "new alerts with severity above 70" or "open vulnerabilities with a CISA KEV CVE"...',
      },
    },
    {
      id: 'q',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Free-text metadata search',
      condition: {
        field: 'operation',
        value: ['crowdstrike_query_alerts', 'crowdstrike_query_cases'],
      },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: [
          'crowdstrike_query_sensors',
          'crowdstrike_query_alerts',
          'crowdstrike_query_host_groups',
          'crowdstrike_query_indicators',
          'crowdstrike_query_vulnerabilities',
          'crowdstrike_query_cases',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: {
        field: 'operation',
        value: [
          'crowdstrike_query_sensors',
          'crowdstrike_query_alerts',
          'crowdstrike_query_host_groups',
          'crowdstrike_query_indicators',
          'crowdstrike_query_cases',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'after',
      title: 'After Cursor',
      type: 'short-input',
      placeholder: 'Cursor from the previous page',
      condition: {
        field: 'operation',
        value: ['crowdstrike_query_indicators', 'crowdstrike_query_vulnerabilities'],
      },
      mode: 'advanced',
    },
    /**
     * Falcon has two sort spellings. Alerts, Spotlight, and Cases document
     * `field|direction`; Host Groups, Identity Protection sensors, and IOC
     * Management document `field.direction`. IOC Management also has its own
     * field names — its sort enum has no `created_timestamp`, only `created_on`
     * and `modified_on` — so it gets a placeholder of its own. One placeholder
     * cannot show all three, so the field is declared three times under the same
     * id with mutually exclusive conditions.
     */
    {
      id: 'sort',
      title: 'Sort',
      type: 'short-input',
      placeholder: 'created_timestamp|desc',
      condition: {
        field: 'operation',
        value: [
          'crowdstrike_query_alerts',
          'crowdstrike_query_vulnerabilities',
          'crowdstrike_query_cases',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'sort',
      title: 'Sort',
      type: 'short-input',
      placeholder: 'created_on.desc',
      condition: { field: 'operation', value: 'crowdstrike_query_indicators' },
      mode: 'advanced',
    },
    {
      id: 'sort',
      title: 'Sort',
      type: 'short-input',
      placeholder: 'name.asc',
      condition: {
        field: 'operation',
        value: ['crowdstrike_query_sensors', 'crowdstrike_query_host_groups'],
      },
      mode: 'advanced',
    },
    {
      /**
       * CrowdStrike declares `include_hidden` with a default of `true` on all
       * three alert endpoints this switch feeds (`GET /alerts/queries/alerts/v2`,
       * `POST /alerts/entities/alerts/v2`, `PATCH /alerts/entities/alerts/v3`).
       * An untouched switch omits the parameter, so Falcon returns hidden alerts
       * either way — seeding `true` makes the rendered state match the wire
       * instead of showing off while hidden alerts come back.
       */
      id: 'includeHidden',
      title: 'Include Hidden Alerts',
      type: 'switch',
      value: () => 'true',
      condition: {
        field: 'operation',
        value: [
          'crowdstrike_query_alerts',
          'crowdstrike_get_alert_details',
          'crowdstrike_update_alerts',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'compositeIds',
      title: 'Composite Alert IDs',
      type: 'code',
      language: 'json',
      placeholder: '["cid:aid:alert-id"]',
      condition: {
        field: 'operation',
        value: ['crowdstrike_get_alert_details', 'crowdstrike_update_alerts'],
      },
      required: {
        field: 'operation',
        value: ['crowdstrike_get_alert_details', 'crowdstrike_update_alerts'],
      },
    },
    {
      id: 'updateStatus',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'New', id: 'new' },
        { label: 'In Progress', id: 'in_progress' },
        { label: 'Reopened', id: 'reopened' },
        { label: 'Closed', id: 'closed' },
      ],
      condition: { field: 'operation', value: 'crowdstrike_update_alerts' },
    },
    {
      id: 'assignToUuid',
      title: 'Assign To UUID',
      type: 'short-input',
      placeholder: '00000000-0000-0000-0000-000000000000',
      condition: { field: 'operation', value: 'crowdstrike_update_alerts' },
    },
    {
      id: 'assignToUserId',
      title: 'Assign To User ID',
      type: 'short-input',
      placeholder: 'analyst@example.com',
      condition: { field: 'operation', value: 'crowdstrike_update_alerts' },
      mode: 'advanced',
    },
    {
      id: 'assignToName',
      title: 'Assign To Name',
      type: 'short-input',
      placeholder: 'Jane Doe',
      condition: { field: 'operation', value: 'crowdstrike_update_alerts' },
      mode: 'advanced',
    },
    {
      id: 'unassign',
      title: 'Unassign',
      type: 'switch',
      condition: { field: 'operation', value: 'crowdstrike_update_alerts' },
      mode: 'advanced',
    },
    {
      id: 'appendComment',
      title: 'Comment',
      type: 'long-input',
      placeholder: 'Triage note to append to the alert',
      condition: { field: 'operation', value: 'crowdstrike_update_alerts' },
    },
    {
      id: 'addTag',
      title: 'Add Tag',
      type: 'short-input',
      placeholder: 'triaged',
      condition: { field: 'operation', value: 'crowdstrike_update_alerts' },
      mode: 'advanced',
    },
    {
      id: 'removeTag',
      title: 'Remove Tag',
      type: 'short-input',
      placeholder: 'needs-review',
      condition: { field: 'operation', value: 'crowdstrike_update_alerts' },
      mode: 'advanced',
    },
    {
      id: 'removeTagsByPrefix',
      title: 'Remove Tags By Prefix',
      type: 'short-input',
      placeholder: 'auto-',
      condition: { field: 'operation', value: 'crowdstrike_update_alerts' },
      mode: 'advanced',
    },
    {
      id: 'showInUi',
      title: 'Show In Falcon Console',
      type: 'switch',
      condition: { field: 'operation', value: 'crowdstrike_update_alerts' },
      mode: 'advanced',
    },
    {
      id: 'actionParameters',
      title: 'Additional Action Parameters',
      type: 'code',
      language: 'json',
      placeholder: '[{ "name": "action_name", "value": "action_value" }]',
      condition: { field: 'operation', value: 'crowdstrike_update_alerts' },
      mode: 'advanced',
    },
    {
      id: 'hostActionName',
      title: 'Host Action',
      type: 'dropdown',
      options: [
        { label: 'Contain (network isolate)', id: 'contain' },
        { label: 'Lift Containment', id: 'lift_containment' },
        { label: 'Hide Host', id: 'hide_host' },
        { label: 'Unhide Host', id: 'unhide_host' },
        { label: 'Suppress Detections', id: 'detection_suppress' },
        { label: 'Unsuppress Detections', id: 'detection_unsuppress' },
      ],
      condition: { field: 'operation', value: 'crowdstrike_perform_host_action' },
      required: { field: 'operation', value: 'crowdstrike_perform_host_action' },
    },
    {
      id: 'deviceIds',
      title: 'Host Agent IDs',
      type: 'code',
      language: 'json',
      placeholder: '["aid-1", "aid-2"]',
      condition: {
        field: 'operation',
        value: ['crowdstrike_perform_host_action', 'crowdstrike_perform_host_group_action'],
      },
      required: {
        field: 'operation',
        value: ['crowdstrike_perform_host_action', 'crowdstrike_perform_host_group_action'],
      },
    },
    {
      id: 'hostGroupIds',
      title: 'Host Group IDs',
      type: 'code',
      language: 'json',
      placeholder: '["host-group-id"]',
      condition: { field: 'operation', value: 'crowdstrike_get_host_group_details' },
      required: { field: 'operation', value: 'crowdstrike_get_host_group_details' },
    },
    {
      id: 'hostGroupActionName',
      title: 'Host Group Action',
      type: 'dropdown',
      options: [
        { label: 'Add Hosts', id: 'add-hosts' },
        { label: 'Remove Hosts', id: 'remove-hosts' },
      ],
      value: () => 'add-hosts',
      condition: { field: 'operation', value: 'crowdstrike_perform_host_group_action' },
      required: { field: 'operation', value: 'crowdstrike_perform_host_group_action' },
    },
    {
      id: 'hostGroupId',
      title: 'Host Group ID',
      type: 'short-input',
      placeholder: 'Static host group ID',
      condition: { field: 'operation', value: 'crowdstrike_perform_host_group_action' },
      required: { field: 'operation', value: 'crowdstrike_perform_host_group_action' },
    },
    {
      id: 'indicatorIds',
      title: 'Indicator IDs',
      type: 'code',
      language: 'json',
      placeholder: '["ioc-id-1"]',
      condition: {
        field: 'operation',
        value: ['crowdstrike_get_indicator_details', 'crowdstrike_delete_indicators'],
      },
      required: { field: 'operation', value: 'crowdstrike_get_indicator_details' },
    },
    {
      id: 'deleteFilter',
      title: 'Delete Filter',
      type: 'short-input',
      placeholder: "type:'sha256'+created_on:<'2026-01-01'",
      condition: { field: 'operation', value: 'crowdstrike_delete_indicators' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a CrowdStrike IOC Management Falcon Query Language (FQL) filter string that selects the custom indicators to delete. Use exact IOC field names, operators, and values only. Return ONLY the filter string - no explanations, no extra text.',
        placeholder:
          'Describe which indicators to delete, for example "every sha256 indicator created before 2026"...',
      },
    },
    {
      id: 'indicators',
      title: 'Indicators',
      type: 'code',
      language: 'json',
      placeholder:
        '[\n  {\n    "type": "sha256",\n    "value": "<hash>",\n    "action": "prevent",\n    "severity": "high",\n    "platforms": ["windows"],\n    "applied_globally": true\n  }\n]',
      condition: {
        field: 'operation',
        value: ['crowdstrike_create_indicators', 'crowdstrike_update_indicators'],
      },
      required: {
        field: 'operation',
        value: ['crowdstrike_create_indicators', 'crowdstrike_update_indicators'],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of CrowdStrike IOC Management indicator objects. Documented fields are type, value, action, severity, platforms (array), applied_globally (boolean), host_groups (array), description, source, tags (array), expiration (ISO 8601), mobile_action, and metadata ({ filename }). Updates must include id and cannot change type or value. Return ONLY valid JSON.',
        placeholder:
          'Describe the indicators you want, for example "block this SHA256 on Windows hosts globally"...',
        generationType: 'json-object',
      },
    },
    {
      id: 'comment',
      title: 'Audit Comment',
      type: 'short-input',
      placeholder: 'Why this change was made',
      condition: {
        field: 'operation',
        value: [
          'crowdstrike_create_indicators',
          'crowdstrike_update_indicators',
          'crowdstrike_delete_indicators',
        ],
      },
    },
    {
      id: 'retrodetects',
      title: 'Generate Retroactive Detections',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['crowdstrike_create_indicators', 'crowdstrike_update_indicators'],
      },
      mode: 'advanced',
    },
    {
      id: 'ignoreWarnings',
      title: 'Ignore Warnings',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['crowdstrike_create_indicators', 'crowdstrike_update_indicators'],
      },
      mode: 'advanced',
    },
    {
      id: 'vulnerabilityIds',
      title: 'Vulnerability IDs',
      type: 'code',
      language: 'json',
      placeholder: '["vulnerability-id"]',
      condition: { field: 'operation', value: 'crowdstrike_get_vulnerability_details' },
      required: { field: 'operation', value: 'crowdstrike_get_vulnerability_details' },
    },
    {
      id: 'deviceId',
      title: 'Host Agent ID',
      type: 'short-input',
      placeholder: 'Agent ID (AID) to connect to',
      condition: { field: 'operation', value: 'crowdstrike_init_rtr_session' },
      required: { field: 'operation', value: 'crowdstrike_init_rtr_session' },
    },
    {
      id: 'queueOffline',
      title: 'Queue If Host Offline',
      type: 'switch',
      condition: { field: 'operation', value: 'crowdstrike_init_rtr_session' },
      mode: 'advanced',
    },
    {
      id: 'origin',
      title: 'Session Origin',
      type: 'short-input',
      placeholder: 'Origin label recorded by CrowdStrike',
      condition: { field: 'operation', value: 'crowdstrike_init_rtr_session' },
      mode: 'advanced',
    },
    {
      id: 'sessionId',
      title: 'RTR Session ID',
      type: 'short-input',
      placeholder: 'Session ID from Init RTR Session',
      condition: {
        field: 'operation',
        value: ['crowdstrike_execute_rtr_command', 'crowdstrike_delete_rtr_session'],
      },
      required: {
        field: 'operation',
        value: ['crowdstrike_execute_rtr_command', 'crowdstrike_delete_rtr_session'],
      },
    },
    {
      id: 'baseCommand',
      title: 'Base Command',
      type: 'dropdown',
      options: [
        { label: 'cat', id: 'cat' },
        { label: 'cd', id: 'cd' },
        { label: 'clear', id: 'clear' },
        { label: 'csrutil (macOS)', id: 'csrutil' },
        { label: 'env', id: 'env' },
        { label: 'eventlog (Windows)', id: 'eventlog' },
        { label: 'filehash', id: 'filehash' },
        { label: 'getsid (Windows, macOS)', id: 'getsid' },
        { label: 'help', id: 'help' },
        { label: 'history', id: 'history' },
        { label: 'ifconfig (macOS, Linux)', id: 'ifconfig' },
        { label: 'ipconfig', id: 'ipconfig' },
        { label: 'ls', id: 'ls' },
        { label: 'mount', id: 'mount' },
        { label: 'netstat', id: 'netstat' },
        { label: 'ps', id: 'ps' },
        { label: 'reg (Windows, query only)', id: 'reg' },
        { label: 'users (Windows)', id: 'users' },
      ],
      value: () => 'ls',
      condition: { field: 'operation', value: 'crowdstrike_execute_rtr_command' },
      required: { field: 'operation', value: 'crowdstrike_execute_rtr_command' },
    },
    {
      id: 'commandString',
      title: 'Command',
      type: 'short-input',
      placeholder: 'ls C:\\Windows\\Temp',
      condition: { field: 'operation', value: 'crowdstrike_execute_rtr_command' },
      required: { field: 'operation', value: 'crowdstrike_execute_rtr_command' },
    },
    {
      id: 'cloudRequestId',
      title: 'Cloud Request ID',
      type: 'short-input',
      placeholder: 'Cloud request ID from Execute RTR Command',
      condition: { field: 'operation', value: 'crowdstrike_get_rtr_command_status' },
      required: { field: 'operation', value: 'crowdstrike_get_rtr_command_status' },
    },
    {
      id: 'sequenceId',
      title: 'Sequence ID',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'crowdstrike_get_rtr_command_status' },
      mode: 'advanced',
    },
    {
      id: 'caseIds',
      title: 'Case IDs',
      type: 'code',
      language: 'json',
      placeholder: '["case-id"]',
      condition: { field: 'operation', value: 'crowdstrike_get_case_details' },
      required: { field: 'operation', value: 'crowdstrike_get_case_details' },
    },
    {
      id: 'ids',
      title: 'Sensor IDs',
      type: 'code',
      language: 'json',
      placeholder: '["device-id-1", "device-id-2"]',
      condition: { field: 'operation', value: 'crowdstrike_get_sensor_details' },
      required: { field: 'operation', value: 'crowdstrike_get_sensor_details' },
    },
    {
      id: 'aggregateQuery',
      title: 'Aggregate Query',
      type: 'code',
      language: 'json',
      placeholder:
        '{\n  "field": "field_name",\n  "name": "aggregate_name",\n  "size": 10,\n  "type": "aggregate_type"\n}',
      condition: { field: 'operation', value: 'crowdstrike_get_sensor_aggregates' },
      required: { field: 'operation', value: 'crowdstrike_get_sensor_aggregates' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a CrowdStrike Identity Protection sensor aggregate query JSON object using documented aggregate body fields such as field, filter, size, sort, type, date_ranges, ranges, extended_bounds, and sub_aggregates. Return ONLY valid JSON.',
        placeholder:
          'Describe the aggregation you want to run, for example "count sensors by status"...',
        generationType: 'json-object',
      },
    },
  ],

  tools: {
    access: [
      'crowdstrike_create_indicators',
      'crowdstrike_delete_indicators',
      'crowdstrike_delete_rtr_session',
      'crowdstrike_execute_rtr_command',
      'crowdstrike_get_alert_details',
      'crowdstrike_get_case_details',
      'crowdstrike_get_host_group_details',
      'crowdstrike_get_indicator_details',
      'crowdstrike_get_rtr_command_status',
      'crowdstrike_get_sensor_aggregates',
      'crowdstrike_get_sensor_details',
      'crowdstrike_get_vulnerability_details',
      'crowdstrike_init_rtr_session',
      'crowdstrike_perform_host_action',
      'crowdstrike_perform_host_group_action',
      'crowdstrike_query_alerts',
      'crowdstrike_query_cases',
      'crowdstrike_query_host_groups',
      'crowdstrike_query_indicators',
      'crowdstrike_query_sensors',
      'crowdstrike_query_vulnerabilities',
      'crowdstrike_update_alerts',
      'crowdstrike_update_indicators',
    ],
    config: {
      tool: (params) =>
        typeof params.operation === 'string' ? params.operation : 'crowdstrike_query_alerts',
      params: (params) => {
        const operation = typeof params.operation === 'string' ? params.operation : ''

        /**
         * The executor merges this result over the raw block inputs, so a key this
         * mapper simply omits keeps the raw subBlock value — and an untouched
         * subBlock is stored as `null`, which the route contract rejects. Seeding
         * every optional key as `undefined` makes omission authoritative: a blank
         * field is dropped, and a value left over from another operation cannot
         * ride along on the request.
         */
        const mapped: Record<string, unknown> = {
          ...CLEARED_OPTIONAL_PARAMS,
          clientId: params.clientId,
          clientSecret: params.clientSecret,
          cloud: params.cloud,
        }

        const setString = (key: string, value: unknown) => {
          mapped[key] = typeof value === 'string' && value.trim().length > 0 ? value : undefined
        }

        const setNumber = (
          key: string,
          value: unknown,
          label: string,
          bounds: { min?: number; max?: number }
        ) => {
          mapped[key] = parseOptionalNumberInput(value, label, { integer: true, ...bounds })
        }

        const setBoolean = (key: string, value: unknown) => {
          mapped[key] = parseOptionalBooleanInput(value)
        }

        const setJson = (key: string, value: unknown, label: string) => {
          mapped[key] = parseOptionalJsonInput(value, label)
        }

        const queryLimit = QUERY_LIMITS[operation]
        if (queryLimit) {
          setString('filter', params.filter)
          setString('sort', params.sort)
          setNumber('limit', params.limit, 'limit', queryLimit)
        }

        if (OFFSET_QUERY_OPERATIONS.has(operation)) {
          setNumber('offset', params.offset, 'offset', { min: 0 })
        }

        if (CURSOR_QUERY_OPERATIONS.has(operation)) {
          setString('after', params.after)
        }

        if (FREE_TEXT_QUERY_OPERATIONS.has(operation)) {
          setString('q', params.q)
        }

        switch (operation) {
          case 'crowdstrike_get_sensor_details':
            setJson('ids', params.ids, 'sensor IDs')
            break
          case 'crowdstrike_get_sensor_aggregates':
            setJson('aggregateQuery', params.aggregateQuery, 'aggregate query')
            break
          case 'crowdstrike_query_alerts':
            setBoolean('includeHidden', params.includeHidden)
            break
          case 'crowdstrike_get_alert_details':
            setJson('compositeIds', params.compositeIds, 'composite alert IDs')
            setBoolean('includeHidden', params.includeHidden)
            break
          case 'crowdstrike_update_alerts':
            setJson('compositeIds', params.compositeIds, 'composite alert IDs')
            setString('updateStatus', params.updateStatus)
            setString('assignToUuid', params.assignToUuid)
            setString('assignToUserId', params.assignToUserId)
            setString('assignToName', params.assignToName)
            setString('appendComment', params.appendComment)
            setString('addTag', params.addTag)
            setString('removeTag', params.removeTag)
            setString('removeTagsByPrefix', params.removeTagsByPrefix)
            setBoolean('unassign', params.unassign)
            setBoolean('showInUi', params.showInUi)
            setBoolean('includeHidden', params.includeHidden)
            setJson('actionParameters', params.actionParameters, 'action parameters')
            break
          case 'crowdstrike_perform_host_action':
            setString('actionName', params.hostActionName)
            setJson('deviceIds', params.deviceIds, 'host agent IDs')
            break
          case 'crowdstrike_get_host_group_details':
            setJson('hostGroupIds', params.hostGroupIds, 'host group IDs')
            break
          case 'crowdstrike_perform_host_group_action':
            setString('actionName', params.hostGroupActionName)
            setString('hostGroupId', params.hostGroupId)
            setJson('deviceIds', params.deviceIds, 'host agent IDs')
            break
          case 'crowdstrike_get_indicator_details':
            setJson('indicatorIds', params.indicatorIds, 'indicator IDs')
            break
          case 'crowdstrike_create_indicators':
          case 'crowdstrike_update_indicators':
            setJson('indicators', params.indicators, 'indicators')
            setString('comment', params.comment)
            setBoolean('retrodetects', params.retrodetects)
            setBoolean('ignoreWarnings', params.ignoreWarnings)
            break
          case 'crowdstrike_delete_indicators':
            setJson('indicatorIds', params.indicatorIds, 'indicator IDs')
            setString('filter', params.deleteFilter)
            setString('comment', params.comment)
            break
          case 'crowdstrike_get_vulnerability_details':
            setJson('vulnerabilityIds', params.vulnerabilityIds, 'vulnerability IDs')
            break
          case 'crowdstrike_init_rtr_session':
            setString('deviceId', params.deviceId)
            setString('origin', params.origin)
            setBoolean('queueOffline', params.queueOffline)
            break
          case 'crowdstrike_execute_rtr_command':
            setString('sessionId', params.sessionId)
            setString('baseCommand', params.baseCommand)
            setString('commandString', params.commandString)
            break
          case 'crowdstrike_get_rtr_command_status':
            setString('cloudRequestId', params.cloudRequestId)
            setNumber('sequenceId', params.sequenceId, 'sequence ID', { min: 0 })
            break
          case 'crowdstrike_delete_rtr_session':
            setString('sessionId', params.sessionId)
            break
          case 'crowdstrike_get_case_details':
            setJson('caseIds', params.caseIds, 'case IDs')
            break
          default:
            break
        }

        return mapped
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Selected CrowdStrike operation' },
    clientId: { type: 'string', description: 'CrowdStrike Falcon API client ID' },
    clientSecret: { type: 'string', description: 'CrowdStrike Falcon API client secret' },
    cloud: { type: 'string', description: 'CrowdStrike Falcon cloud region' },
    filter: { type: 'string', description: 'Falcon Query Language filter' },
    deleteFilter: {
      type: 'string',
      description: 'Falcon Query Language filter selecting the indicators to delete',
    },
    q: { type: 'string', description: 'Free-text metadata search' },
    ids: { type: 'json', description: 'JSON array of CrowdStrike sensor device IDs' },
    aggregateQuery: {
      type: 'json',
      description: 'CrowdStrike sensor aggregate query body as JSON',
    },
    limit: { type: 'number', description: 'Maximum number of records to return' },
    offset: { type: 'number', description: 'Pagination offset' },
    after: { type: 'string', description: 'Cursor for the next page of results' },
    sort: { type: 'string', description: 'Sort expression' },
    includeHidden: { type: 'boolean', description: 'Include previously hidden alerts' },
    compositeIds: { type: 'json', description: 'JSON array of composite alert IDs' },
    updateStatus: { type: 'string', description: 'New alert status' },
    assignToUuid: { type: 'string', description: 'Falcon user UUID to assign alerts to' },
    assignToUserId: { type: 'string', description: 'Falcon user ID to assign alerts to' },
    assignToName: { type: 'string', description: 'Falcon username to assign alerts to' },
    unassign: { type: 'boolean', description: 'Clear the alert assignment' },
    appendComment: { type: 'string', description: 'Comment to append to the alert' },
    addTag: { type: 'string', description: 'Tag to add to the alert' },
    removeTag: { type: 'string', description: 'Tag to remove from the alert' },
    removeTagsByPrefix: {
      type: 'string',
      description: 'Remove every alert tag starting with this prefix',
    },
    showInUi: { type: 'boolean', description: 'Whether the alert shows in the Falcon console' },
    actionParameters: {
      type: 'json',
      description: 'Additional alert action parameters as { name, value } objects',
    },
    hostActionName: { type: 'string', description: 'Host action to perform' },
    deviceIds: { type: 'json', description: 'JSON array of host agent IDs' },
    hostGroupIds: { type: 'json', description: 'JSON array of host group IDs' },
    hostGroupActionName: { type: 'string', description: 'Host group action to perform' },
    hostGroupId: { type: 'string', description: 'Host group ID to modify' },
    indicatorIds: { type: 'json', description: 'JSON array of indicator IDs' },
    indicators: { type: 'json', description: 'JSON array of indicator objects' },
    comment: { type: 'string', description: 'Audit comment for indicator changes' },
    retrodetects: { type: 'boolean', description: 'Generate retroactive detections' },
    ignoreWarnings: { type: 'boolean', description: 'Apply indicator changes despite warnings' },
    vulnerabilityIds: { type: 'json', description: 'JSON array of Spotlight vulnerability IDs' },
    deviceId: { type: 'string', description: 'Host agent ID for the RTR session' },
    queueOffline: { type: 'boolean', description: 'Queue the RTR session for an offline host' },
    origin: { type: 'string', description: 'RTR session origin label' },
    sessionId: { type: 'string', description: 'RTR session ID' },
    baseCommand: { type: 'string', description: 'Read-only RTR base command' },
    commandString: { type: 'string', description: 'Full RTR command line to run' },
    cloudRequestId: { type: 'string', description: 'RTR cloud request ID' },
    sequenceId: { type: 'number', description: 'RTR output chunk sequence' },
    caseIds: { type: 'json', description: 'JSON array of Case Management case IDs' },
  },

  outputs: {
    sensors: {
      type: 'json',
      description:
        'CrowdStrike identity sensor records (agentVersion, cid, deviceId, heartbeatTime, hostname, idpPolicyId, idpPolicyName, ipAddress, kerberosConfig, ldapConfig, ldapsConfig, machineDomain, ntlmConfig, osVersion, rdpToDcConfig, smbToDcConfig, status, statusCauses, tiEnabled)',
    },
    aggregates: {
      type: 'json',
      description:
        'CrowdStrike aggregate result groups (name, buckets, docCountErrorUpperBound, sumOtherDocCount)',
    },
    alertIds: { type: 'json', description: 'Composite alert IDs matching an alert query' },
    alerts: {
      type: 'json',
      description:
        'CrowdStrike alert records (compositeId, id, cid, name, description, type, product, platform, severity, severityName, status, assignedToName, tactic, technique, deviceId, hostname, tags, timestamps)',
    },
    updatedIds: { type: 'json', description: 'Composite alert IDs an update was submitted for' },
    affected: {
      type: 'json',
      description: 'Entities affected by a host action (id, path)',
    },
    hostGroupIds: { type: 'json', description: 'Host group IDs matching a host group query' },
    hostGroups: {
      type: 'json',
      description:
        'CrowdStrike host group records (id, name, description, groupType, assignmentRule, createdBy, createdTimestamp, modifiedBy, modifiedTimestamp)',
    },
    indicatorIds: { type: 'json', description: 'Indicator IDs matching an indicator query' },
    indicators: {
      type: 'json',
      description:
        'CrowdStrike indicator records (id, type, value, action, severity, platforms, hostGroups, appliedGlobally, tags, expiration, metadata, timestamps)',
    },
    deletedIds: { type: 'json', description: 'Indicator IDs CrowdStrike deleted' },
    vulnerabilityIds: {
      type: 'json',
      description: 'Spotlight vulnerability IDs matching a vulnerability query',
    },
    vulnerabilities: {
      type: 'json',
      description:
        'Spotlight vulnerability records (id, aid, status, cve, app, hostInfo, remediations, suppressionInfo, timestamps)',
    },
    sessionId: { type: 'string', description: 'RTR session ID' },
    deviceId: { type: 'string', description: 'Host ID (AID) the RTR session was opened against' },
    platform: { type: 'string', description: 'Platform of the host in the RTR session' },
    pwd: { type: 'string', description: 'Working directory the RTR session started in' },
    offlineQueued: {
      type: 'boolean',
      description: 'Whether the RTR session was queued for an offline host',
    },
    existingAidSessions: {
      type: 'number',
      description: 'Number of RTR sessions already open against the host',
    },
    createdAt: { type: 'string', description: 'When the RTR session was created' },
    cloudRequestId: { type: 'string', description: 'RTR cloud request ID to poll for output' },
    queuedCommandOffline: {
      type: 'boolean',
      description: 'Whether the RTR command was queued because the host is offline',
    },
    baseCommand: { type: 'string', description: 'Base RTR command the status refers to' },
    taskId: { type: 'string', description: 'RTR task ID for the executed command' },
    sequenceId: { type: 'number', description: 'Sequence number of the RTR command output chunk' },
    complete: { type: 'boolean', description: 'Whether an RTR command has finished' },
    stdout: { type: 'string', description: 'Standard output from an RTR command' },
    stderr: { type: 'string', description: 'Standard error from an RTR command' },
    deleted: { type: 'boolean', description: 'Whether the RTR session was closed' },
    caseIds: { type: 'json', description: 'Case IDs matching a case query' },
    cases: {
      type: 'json',
      description:
        'CrowdStrike Case Management records (id, name, description, status, severity, severityLevel, referenceId, assignedTo, tags, timestamps)',
    },
    pagination: {
      type: 'json',
      description: 'Pagination metadata (limit, offset, total, after) for query responses',
    },
    errors: {
      type: 'json',
      description:
        'Per-item errors CrowdStrike returned alongside a partially successful response (code, id, message)',
    },
    count: { type: 'number', description: 'Number of records returned by the selected operation' },
  },
}

export const CrowdStrikeBlockMeta = {
  tags: ['identity', 'monitoring', 'incident-management', 'automation'],
  url: 'https://www.crowdstrike.com',
  templates: [
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike alert triage',
      prompt:
        'Create a workflow that queries new high-severity CrowdStrike alerts, pulls their details, summarizes the tactic, technique, and affected host for each, posts the triage summary to Slack, and marks the reviewed alerts in progress.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['security', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike host containment',
      prompt:
        'Create a workflow that takes a host ID, contains the host in CrowdStrike, opens a Real Time Response session to capture running processes and network connections, and posts the collected evidence to Slack for the on-call responder.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['security', 'incident-response'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike IOC sync',
      prompt:
        'Create a workflow that reads indicators of compromise from a table, creates them as custom CrowdStrike indicators with a blocking action and an expiration, and records the returned indicator IDs back to the table.',
      modules: ['agent', 'tables', 'workflows'],
      category: 'operations',
      tags: ['security', 'automation'],
    },
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike vulnerability report',
      prompt:
        'Create a scheduled workflow that queries CrowdStrike Spotlight for open critical vulnerabilities, pulls the CVE and remediation details, groups them by host, and writes a prioritized remediation report for the platform team.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['security', 'reporting'],
    },
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike case digest',
      prompt:
        'Create a scheduled workflow that queries open CrowdStrike Case Management cases, pulls each case status, severity, and assignee, and posts a daily standup digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['security', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike sensor coverage gaps',
      prompt:
        'Create a scheduled workflow that queries CrowdStrike Identity Protection sensors, identifies devices reporting an unprotected or degraded status, opens a PagerDuty incident for critical gaps, and posts the list to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['pagerduty', 'slack'],
    },
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike weekly sensor digest',
      prompt:
        'Create a scheduled weekly workflow that runs CrowdStrike sensor aggregate queries by status and OS version, summarizes coverage and unprotected counts, and writes a digest file for security leadership.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'reporting'],
    },
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike + Okta coverage check',
      prompt:
        'Build a workflow that lists CrowdStrike Identity Protection sensors and cross-references them with Okta users and devices to find accounts active on endpoints that have no protected sensor, then writes the findings to a security table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'analysis'],
      alsoIntegrations: ['okta'],
    },
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike asset inventory',
      prompt:
        'Create a scheduled workflow that queries CrowdStrike Identity Protection sensors per device, identifies endpoints reporting an unprotected status, and writes the gap list to a compliance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
    },
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike stale sensor finder',
      prompt:
        'Build a scheduled workflow that queries CrowdStrike sensors, flags devices whose last heartbeat is older than a threshold, and writes the stale-sensor list to a SOC investigation table for follow-up.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'analysis'],
    },
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike coverage report doc',
      prompt:
        'Create a scheduled workflow that aggregates CrowdStrike sensor status, OS version, and policy assignment, and generates a coverage report doc in Google Docs for the security team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'reporting'],
      alsoIntegrations: ['google_docs'],
    },
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike policy drift watcher',
      prompt:
        'Build a scheduled workflow that queries CrowdStrike Identity Protection sensors, compares each device’s assigned IdP policy against the expected baseline, and writes mismatches to a SOC review queue.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'analysis'],
    },
  ],
  skills: [
    {
      name: 'triage-falcon-alerts',
      description:
        'Query CrowdStrike alerts, pull their details, and summarize severity, tactic, and affected host for SOC triage.',
      content:
        '# Triage CrowdStrike Alerts\n\nWork a queue of Falcon alerts down to a reviewed state.\n\n## Steps\n1. Query alerts with an FQL filter for the status and severity you care about.\n2. Pull alert details for the returned composite IDs.\n3. Summarize each alert by severity, tactic, technique, and affected host.\n4. Update the reviewed alerts with a new status and an audit comment.\n\n## Output\nA triage summary per alert plus the list of alert IDs whose status was updated.',
    },
    {
      name: 'contain-compromised-host',
      description:
        'Contain a CrowdStrike host and collect live evidence through a Real Time Response session.',
      content:
        '# Contain a Compromised Host\n\nIsolate a host and gather evidence before responders arrive.\n\n## Steps\n1. Run the contain action against the target host ID.\n2. Open a Real Time Response session on that host.\n3. Run read-tier commands (ps, netstat, ls, filehash) and poll each cloud request ID for output.\n4. Close the session when collection is done.\n\n## Output\nConfirmation the host was contained, plus the captured command output for the incident record.',
    },
    {
      name: 'manage-custom-indicators',
      description:
        'Create, update, search, and delete custom CrowdStrike indicators of compromise.',
      content:
        '# Manage Custom CrowdStrike Indicators\n\nKeep the custom IOC list current.\n\n## Steps\n1. Query existing indicators with an FQL filter to see what is already covered.\n2. Create new indicators with the intended action, platforms, and expiration.\n3. Update severity, action, or expiration on indicators that need changing.\n4. Delete indicators that are stale, scoping deletes by explicit IDs rather than a broad filter.\n\n## Output\nThe indicator IDs created, updated, or deleted, plus any per-item errors CrowdStrike returned.',
    },
    {
      name: 'prioritize-spotlight-vulnerabilities',
      description:
        'Query CrowdStrike Spotlight vulnerabilities and rank them by severity, exploit status, and affected host.',
      content:
        '# Prioritize Spotlight Vulnerabilities\n\nTurn the Spotlight backlog into a ranked remediation list.\n\n## Steps\n1. Query vulnerabilities with an FQL filter (Spotlight requires one) for open findings.\n2. Pull details for the returned IDs to get CVE data, host info, and remediations.\n3. Rank by CVE severity and exploit status, then group by host or application.\n\n## Output\nA prioritized remediation list naming each CVE, its affected hosts, and the recommended fix.',
    },
    {
      name: 'audit-identity-sensors',
      description:
        'Query CrowdStrike Identity Protection sensors and report on coverage, status, and devices missing protection.',
      content:
        '# Audit CrowdStrike Identity Sensors\n\nReview Identity Protection sensor coverage across the fleet.\n\n## Steps\n1. Query sensors, optionally filtered by status or hostname.\n2. For sensors of interest, pull detailed attributes (version, last seen, assigned policy).\n3. Flag sensors that are offline, stale, or out of policy.\n\n## Output\nA coverage report listing healthy sensors, plus any that are offline, stale, or misconfigured for SOC review.',
    },
    {
      name: 'summarize-sensor-aggregates',
      description:
        'Pull documented CrowdStrike sensor aggregates and summarize the fleet distribution by version, status, or platform.',
      content:
        '# Summarize CrowdStrike Sensor Aggregates\n\nBuild a high-level picture of the sensor fleet.\n\n## Steps\n1. Request the documented sensor aggregates (e.g. counts by version, status, or platform).\n2. Compute the distribution and identify outliers, such as a large share of outdated versions.\n3. Compare against the expected baseline.\n\n## Output\nA fleet summary with key counts and any segments that need attention (outdated, offline).',
    },
  ],
} as const satisfies BlockMeta
