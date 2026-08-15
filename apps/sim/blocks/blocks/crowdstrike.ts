import { CrowdStrikeIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import {
  parseOptionalBooleanInput,
  parseOptionalJsonInput,
  parseOptionalNumberInput,
} from '@/blocks/utils'
import type { CrowdStrikeResponse } from '@/tools/crowdstrike/types'

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
          { text: ', matching', field: 'filter' },
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
          'crowdstrike_delete_indicators',
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
    {
      id: 'sort',
      title: 'Sort',
      type: 'short-input',
      placeholder: 'created_timestamp|desc',
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
      id: 'includeHidden',
      title: 'Include Hidden Alerts',
      type: 'switch',
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
      ],
      value: () => 'contain',
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
        { label: 'env', id: 'env' },
        { label: 'eventlog (Windows)', id: 'eventlog' },
        { label: 'filehash', id: 'filehash' },
        { label: 'getsid', id: 'getsid' },
        { label: 'help', id: 'help' },
        { label: 'history', id: 'history' },
        { label: 'ipconfig (Windows)', id: 'ipconfig' },
        { label: 'ls', id: 'ls' },
        { label: 'mount', id: 'mount' },
        { label: 'netstat', id: 'netstat' },
        { label: 'ps', id: 'ps' },
        { label: 'reg query (Windows)', id: 'reg query' },
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
        const mapped: Record<string, unknown> = {
          clientId: params.clientId,
          clientSecret: params.clientSecret,
          cloud: params.cloud,
        }

        const setString = (key: string, value: unknown) => {
          if (typeof value === 'string' && value.trim().length > 0) mapped[key] = value
        }

        const setNumber = (
          key: string,
          value: unknown,
          label: string,
          bounds: { min?: number; max?: number }
        ) => {
          const parsed = parseOptionalNumberInput(value, label, { integer: true, ...bounds })
          if (parsed != null) mapped[key] = parsed
        }

        const setBoolean = (key: string, value: unknown) => {
          const parsed = parseOptionalBooleanInput(value)
          if (parsed !== undefined) mapped[key] = parsed
        }

        const setJson = (key: string, value: unknown, label: string) => {
          const parsed = parseOptionalJsonInput(value, label)
          if (parsed !== undefined) mapped[key] = parsed
        }

        const QUERY_LIMITS: Record<string, { min: number; max: number }> = {
          crowdstrike_query_sensors: { min: 1, max: 200 },
          crowdstrike_query_alerts: { min: 1, max: 10000 },
          crowdstrike_query_host_groups: { min: 1, max: 5000 },
          crowdstrike_query_indicators: { min: 1, max: 2000 },
          crowdstrike_query_vulnerabilities: { min: 1, max: 400 },
          crowdstrike_query_cases: { min: 1, max: 10000 },
        }

        if (operation in QUERY_LIMITS) {
          setString('filter', params.filter)
          setString('sort', params.sort)
          setNumber('limit', params.limit, 'limit', QUERY_LIMITS[operation])
          setNumber('offset', params.offset, 'offset', { min: 0 })
          setString('after', params.after)
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
            setString('filter', params.filter)
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
    cloudRequestId: { type: 'string', description: 'RTR cloud request ID to poll for output' },
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
      description: 'Per-item errors CrowdStrike returned alongside a partially successful response',
    },
    count: { type: 'number', description: 'Number of records returned by the selected operation' },
  },
}

export const CrowdStrikeBlockMeta = {
  tags: ['identity', 'monitoring'],
  url: 'https://www.crowdstrike.com',
  templates: [
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
