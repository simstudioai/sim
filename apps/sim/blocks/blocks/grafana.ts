import { GrafanaBlockDisplay } from '@/blocks/blocks/grafana.display'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { GrafanaResponse } from '@/tools/grafana/types'

export const GrafanaBlock: BlockConfig<GrafanaResponse> = {
  ...GrafanaBlockDisplay,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Dashboards', id: 'grafana_list_dashboards' },
        { label: 'Get Dashboard', id: 'grafana_get_dashboard' },
        { label: 'Create Dashboard', id: 'grafana_create_dashboard' },
        { label: 'Update Dashboard', id: 'grafana_update_dashboard' },
        { label: 'Delete Dashboard', id: 'grafana_delete_dashboard' },
        { label: 'List Alert Rules', id: 'grafana_list_alert_rules' },
        { label: 'Get Alert Rule', id: 'grafana_get_alert_rule' },
        { label: 'Create Alert Rule', id: 'grafana_create_alert_rule' },
        { label: 'Update Alert Rule', id: 'grafana_update_alert_rule' },
        { label: 'Delete Alert Rule', id: 'grafana_delete_alert_rule' },
        { label: 'List Contact Points', id: 'grafana_list_contact_points' },
        { label: 'Create Contact Point', id: 'grafana_create_contact_point' },
        { label: 'Create Annotation', id: 'grafana_create_annotation' },
        { label: 'List Annotations', id: 'grafana_list_annotations' },
        { label: 'Update Annotation', id: 'grafana_update_annotation' },
        { label: 'Delete Annotation', id: 'grafana_delete_annotation' },
        { label: 'List Data Sources', id: 'grafana_list_data_sources' },
        { label: 'Get Data Source', id: 'grafana_get_data_source' },
        { label: 'Check Data Source Health', id: 'grafana_check_data_source_health' },
        { label: 'List Folders', id: 'grafana_list_folders' },
        { label: 'Create Folder', id: 'grafana_create_folder' },
        { label: 'Get Folder', id: 'grafana_get_folder' },
        { label: 'Update Folder', id: 'grafana_update_folder' },
        { label: 'Delete Folder', id: 'grafana_delete_folder' },
        { label: 'Get Health', id: 'grafana_get_health' },
      ],
      value: () => 'grafana_list_dashboards',
    },

    {
      id: 'baseUrl',
      title: 'Grafana URL',
      type: 'short-input',
      placeholder: 'https://your-grafana.com',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'Service Account Token',
      type: 'short-input',
      placeholder: 'glsa_...',
      password: true,
      required: true,
    },
    {
      id: 'organizationId',
      title: 'Organization ID',
      type: 'short-input',
      placeholder: 'Optional - for multi-org instances',
    },

    {
      id: 'dataSourceId',
      title: 'Data Source ID',
      type: 'short-input',
      placeholder: 'Enter data source ID or UID',
      required: true,
      condition: {
        field: 'operation',
        value: 'grafana_get_data_source',
      },
    },
    {
      id: 'dataSourceUid',
      title: 'Data Source UID',
      type: 'short-input',
      placeholder: 'Enter data source UID',
      required: true,
      condition: {
        field: 'operation',
        value: 'grafana_check_data_source_health',
      },
    },

    {
      id: 'dashboardUid',
      title: 'Dashboard UID',
      type: 'short-input',
      placeholder: 'Enter dashboard UID',
      required: true,
      condition: {
        field: 'operation',
        value: ['grafana_get_dashboard', 'grafana_update_dashboard', 'grafana_delete_dashboard'],
      },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Filter dashboards by title',
      condition: { field: 'operation', value: 'grafana_list_dashboards' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Grafana dashboard search query based on the user's description.
The query should be a simple text string to filter dashboards by title.

Examples:
- "production dashboards" -> production
- "kubernetes monitoring" -> kubernetes
- "api performance" -> api performance

Return ONLY the search query - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the dashboards you want to find...',
      },
    },
    {
      id: 'tag',
      title: 'Filter by Tag',
      type: 'short-input',
      placeholder: 'tag1, tag2 (comma-separated)',
      condition: { field: 'operation', value: 'grafana_list_dashboards' },
    },
    {
      id: 'folderUIDs',
      title: 'Folder UIDs',
      type: 'short-input',
      placeholder: 'uid1, uid2 (comma-separated)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'grafana_list_dashboards' },
    },
    {
      id: 'dashboardUIDs',
      title: 'Dashboard UIDs',
      type: 'short-input',
      placeholder: 'uid1, uid2 (comma-separated)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'grafana_list_dashboards' },
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: 'Page number (1-based)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['grafana_list_dashboards', 'grafana_list_folders'],
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Maximum results to return',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['grafana_list_dashboards', 'grafana_list_folders', 'grafana_list_annotations'],
      },
    },
    {
      id: 'starred',
      title: 'Only Starred',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'grafana_list_dashboards' },
    },

    {
      id: 'title',
      title: 'Dashboard Title',
      type: 'short-input',
      placeholder: 'Enter dashboard title',
      required: true,
      condition: { field: 'operation', value: 'grafana_create_dashboard' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a professional Grafana dashboard title based on the user's description.
The title should be:
- Clear and descriptive
- Indicate the purpose or scope of monitoring
- Concise (typically 2-5 words)

Examples:
- "api monitoring" -> API Performance Dashboard
- "kubernetes cluster" -> Kubernetes Cluster Overview
- "database metrics" -> Database Health & Metrics

Return ONLY the title - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the dashboard...',
      },
    },
    {
      id: 'folderUid',
      title: 'Folder UID',
      type: 'short-input',
      placeholder: 'Folder UID (required for alert rules, optional for dashboards)',
      required: { field: 'operation', value: 'grafana_create_alert_rule' },
      condition: {
        field: 'operation',
        value: [
          'grafana_create_dashboard',
          'grafana_update_dashboard',
          'grafana_create_alert_rule',
          'grafana_update_alert_rule',
        ],
      },
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'tag1, tag2 (comma-separated)',
      condition: {
        field: 'operation',
        value: ['grafana_create_dashboard', 'grafana_update_dashboard'],
      },
    },
    {
      id: 'panels',
      title: 'Panels (JSON)',
      type: 'long-input',
      placeholder: 'JSON array of panel configurations',
      condition: {
        field: 'operation',
        value: ['grafana_create_dashboard', 'grafana_update_dashboard'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate Grafana panel configurations as a JSON array based on the user's description.

Basic panel structure:
[
  {
    "title": "Panel Title",
    "type": "graph|stat|gauge|table|text|heatmap|bargauge",
    "gridPos": {"x": 0, "y": 0, "w": 12, "h": 8},
    "targets": [
      {
        "expr": "prometheus_query_here",
        "refId": "A"
      }
    ]
  }
]

Common panel types:
- "graph" / "timeseries": Line charts for time-series data
- "stat": Single value display
- "gauge": Gauge visualization
- "table": Tabular data
- "bargauge": Bar gauge

Examples:
- "CPU usage panel" -> [{"title":"CPU Usage","type":"timeseries","gridPos":{"x":0,"y":0,"w":12,"h":8},"targets":[{"expr":"100 - (avg(irate(node_cpu_seconds_total{mode=\"idle\"}[5m])) * 100)","refId":"A"}]}]

Return ONLY the JSON array - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the panels you want to create...',
        generationType: 'json-object',
      },
    },
    {
      id: 'message',
      title: 'Commit Message',
      type: 'short-input',
      placeholder: 'Optional version message',
      condition: {
        field: 'operation',
        value: ['grafana_create_dashboard', 'grafana_update_dashboard'],
      },
    },
    {
      id: 'overwrite',
      title: 'Overwrite on Conflict',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['grafana_create_dashboard', 'grafana_update_dashboard'],
      },
    },

    {
      id: 'alertRuleUid',
      title: 'Alert Rule UID',
      type: 'short-input',
      placeholder: 'Enter alert rule UID',
      required: true,
      condition: {
        field: 'operation',
        value: ['grafana_get_alert_rule', 'grafana_update_alert_rule', 'grafana_delete_alert_rule'],
      },
    },
    {
      id: 'alertTitle',
      title: 'Alert Title',
      type: 'short-input',
      placeholder: 'Enter alert rule name',
      required: { field: 'operation', value: 'grafana_create_alert_rule' },
      condition: {
        field: 'operation',
        value: ['grafana_create_alert_rule', 'grafana_update_alert_rule'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a professional Grafana alert rule name based on the user's description.
The name should be:
- Clear and descriptive
- Indicate what is being monitored and the condition
- Follow naming conventions (PascalCase or with spaces)

Examples:
- "high cpu alert" -> High CPU Usage Alert
- "disk space warning" -> Low Disk Space Warning
- "api error rate" -> API Error Rate Threshold

Return ONLY the alert title - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the alert...',
      },
    },
    {
      id: 'ruleGroup',
      title: 'Rule Group',
      type: 'short-input',
      placeholder: 'Enter rule group name',
      required: { field: 'operation', value: 'grafana_create_alert_rule' },
      condition: {
        field: 'operation',
        value: ['grafana_create_alert_rule', 'grafana_update_alert_rule'],
      },
    },
    {
      id: 'condition',
      title: 'Condition',
      type: 'short-input',
      placeholder: 'Condition refId (e.g., A)',
      condition: {
        field: 'operation',
        value: ['grafana_create_alert_rule', 'grafana_update_alert_rule'],
      },
    },
    {
      id: 'data',
      title: 'Query Data (JSON)',
      type: 'long-input',
      placeholder: 'JSON array of query/expression data objects',
      required: { field: 'operation', value: 'grafana_create_alert_rule' },
      condition: {
        field: 'operation',
        value: ['grafana_create_alert_rule', 'grafana_update_alert_rule'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate Grafana alert query data as a JSON array based on the user's description.

Structure for alert queries:
[
  {
    "refId": "A",
    "datasourceUid": "datasource_uid",
    "model": {
      "expr": "prometheus_query",
      "refId": "A"
    }
  },
  {
    "refId": "B",
    "datasourceUid": "-100",
    "model": {
      "type": "reduce",
      "expression": "A",
      "reducer": "last"
    }
  },
  {
    "refId": "C",
    "datasourceUid": "-100",
    "model": {
      "type": "threshold",
      "expression": "B",
      "conditions": [{"evaluator": {"type": "gt", "params": [80]}}]
    }
  }
]

Examples:
- "alert when CPU > 80%" -> Query for CPU metrics with threshold condition
- "memory usage warning" -> Query for memory with reduce and threshold

Return ONLY the JSON array - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the alert query conditions...',
        generationType: 'json-object',
      },
    },
    {
      id: 'forDuration',
      title: 'For Duration',
      type: 'short-input',
      placeholder: '5m (e.g., 5m, 1h)',
      condition: {
        field: 'operation',
        value: ['grafana_create_alert_rule', 'grafana_update_alert_rule'],
      },
    },
    {
      id: 'noDataState',
      title: 'No Data State',
      type: 'dropdown',
      options: [
        { label: 'No Data', id: 'NoData' },
        { label: 'Alerting', id: 'Alerting' },
        { label: 'OK', id: 'OK' },
      ],
      value: () => 'NoData',
      condition: {
        field: 'operation',
        value: ['grafana_create_alert_rule', 'grafana_update_alert_rule'],
      },
    },
    {
      id: 'execErrState',
      title: 'Error State',
      type: 'dropdown',
      options: [
        { label: 'Error', id: 'Error' },
        { label: 'Alerting', id: 'Alerting' },
        { label: 'OK', id: 'OK' },
      ],
      value: () => 'Error',
      condition: {
        field: 'operation',
        value: ['grafana_create_alert_rule', 'grafana_update_alert_rule'],
      },
    },
    {
      id: 'annotations',
      title: 'Annotations (JSON)',
      type: 'long-input',
      placeholder: 'JSON object of alert annotations (e.g., {"summary":"..."})',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['grafana_create_alert_rule', 'grafana_update_alert_rule'],
      },
    },
    {
      id: 'labels',
      title: 'Labels (JSON)',
      type: 'long-input',
      placeholder: 'JSON object of alert labels (e.g., {"severity":"critical"})',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['grafana_create_alert_rule', 'grafana_update_alert_rule'],
      },
    },
    {
      id: 'isPaused',
      title: 'Paused',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['grafana_create_alert_rule', 'grafana_update_alert_rule'],
      },
    },
    {
      id: 'keepFiringFor',
      title: 'Keep Firing For',
      type: 'short-input',
      placeholder: 'e.g., 5m',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['grafana_create_alert_rule', 'grafana_update_alert_rule'],
      },
    },
    {
      id: 'missingSeriesEvalsToResolve',
      title: 'Missing Series Evals to Resolve',
      type: 'short-input',
      placeholder: 'e.g., 2',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['grafana_create_alert_rule', 'grafana_update_alert_rule'],
      },
    },
    {
      id: 'notificationSettings',
      title: 'Notification Settings (JSON)',
      type: 'long-input',
      placeholder: 'JSON object of per-rule notification overrides',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['grafana_create_alert_rule', 'grafana_update_alert_rule'],
      },
    },
    {
      id: 'record',
      title: 'Recording Rule (JSON)',
      type: 'long-input',
      placeholder: 'JSON object configuring this as a recording rule',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['grafana_create_alert_rule', 'grafana_update_alert_rule'],
      },
    },
    {
      id: 'alertRuleUidNew',
      title: 'Custom Alert Rule UID',
      type: 'short-input',
      placeholder: 'Optional - auto-generated if not provided',
      mode: 'advanced',
      condition: { field: 'operation', value: 'grafana_create_alert_rule' },
    },
    {
      id: 'disableProvenance',
      title: 'Disable Provenance',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'grafana_create_alert_rule',
          'grafana_update_alert_rule',
          'grafana_create_contact_point',
        ],
      },
    },

    {
      id: 'text',
      title: 'Annotation Text',
      type: 'long-input',
      placeholder: 'Enter annotation text...',
      required: { field: 'operation', value: 'grafana_create_annotation' },
      condition: {
        field: 'operation',
        value: ['grafana_create_annotation', 'grafana_update_annotation'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate annotation text for Grafana based on the user's description.
The annotation should:
- Clearly describe the event or observation
- Be concise but informative
- Include relevant details (what happened, impact, etc.)

Examples:
- "deployment started" -> Deployment v2.3.1 started - API service
- "high traffic period" -> High traffic period began - 3x normal load
- "config change" -> Configuration update: increased connection pool size to 50

Return ONLY the annotation text - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the annotation...',
      },
    },
    {
      id: 'annotationTags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'tag1, tag2 (comma-separated)',
      condition: {
        field: 'operation',
        value: [
          'grafana_create_annotation',
          'grafana_update_annotation',
          'grafana_list_annotations',
        ],
      },
    },
    {
      id: 'annotationDashboardUid',
      title: 'Dashboard UID',
      type: 'short-input',
      placeholder: 'Optional - omit for organization-wide annotations',
      condition: {
        field: 'operation',
        value: ['grafana_create_annotation', 'grafana_list_annotations'],
      },
    },
    {
      id: 'panelId',
      title: 'Panel ID',
      type: 'short-input',
      placeholder: 'Optional - attach to specific panel',
      condition: {
        field: 'operation',
        value: ['grafana_create_annotation', 'grafana_list_annotations'],
      },
    },
    {
      id: 'alertId',
      title: 'Alert ID',
      type: 'short-input',
      placeholder: 'Filter by alert ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'grafana_list_annotations' },
    },
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Filter by creator user ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'grafana_list_annotations' },
    },
    {
      id: 'annotationType',
      title: 'Type',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Alert', id: 'alert' },
        { label: 'Annotation', id: 'annotation' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: { field: 'operation', value: 'grafana_list_annotations' },
    },
    {
      id: 'time',
      title: 'Time (epoch ms)',
      type: 'short-input',
      placeholder: 'Optional - defaults to now',
      condition: {
        field: 'operation',
        value: ['grafana_create_annotation', 'grafana_update_annotation'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an epoch timestamp in milliseconds based on the user's description.
The timestamp should be a Unix epoch time in milliseconds (13 digits).
Examples:
- "now" -> Current timestamp in milliseconds
- "yesterday" -> Yesterday at 00:00:00 in milliseconds
- "1 hour ago" -> Subtract 3600000 from current time

Return ONLY the numeric timestamp - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the time (e.g., "now", "1 hour ago", "yesterday at noon")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'timeEnd',
      title: 'End Time (epoch ms)',
      type: 'short-input',
      placeholder: 'Optional - for range annotations',
      condition: {
        field: 'operation',
        value: ['grafana_create_annotation', 'grafana_update_annotation'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an epoch timestamp in milliseconds based on the user's description.
The timestamp should be a Unix epoch time in milliseconds (13 digits).
Examples:
- "now" -> Current timestamp in milliseconds
- "in 1 hour" -> Add 3600000 to current time
- "end of today" -> Today at 23:59:59 in milliseconds

Return ONLY the numeric timestamp - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end time (e.g., "in 1 hour", "end of today")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'annotationId',
      title: 'Annotation ID',
      type: 'short-input',
      placeholder: 'Enter annotation ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['grafana_update_annotation', 'grafana_delete_annotation'],
      },
    },
    {
      id: 'from',
      title: 'From Time (epoch ms)',
      type: 'short-input',
      placeholder: 'Filter from time',
      condition: { field: 'operation', value: 'grafana_list_annotations' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an epoch timestamp in milliseconds based on the user's description.
The timestamp should be a Unix epoch time in milliseconds (13 digits).
Examples:
- "last week" -> 7 days ago at 00:00:00 in milliseconds
- "beginning of this month" -> First day of current month at 00:00:00
- "24 hours ago" -> Subtract 86400000 from current time

Return ONLY the numeric timestamp - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start time (e.g., "last week", "beginning of this month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'to',
      title: 'To Time (epoch ms)',
      type: 'short-input',
      placeholder: 'Filter to time',
      condition: { field: 'operation', value: 'grafana_list_annotations' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an epoch timestamp in milliseconds based on the user's description.
The timestamp should be a Unix epoch time in milliseconds (13 digits).
Examples:
- "now" -> Current timestamp in milliseconds
- "end of today" -> Today at 23:59:59 in milliseconds
- "end of last week" -> Last Sunday at 23:59:59 in milliseconds

Return ONLY the numeric timestamp - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end time (e.g., "now", "end of today")...',
        generationType: 'timestamp',
      },
    },

    {
      id: 'folderTitle',
      title: 'Folder Title',
      type: 'short-input',
      placeholder: 'Enter folder title',
      required: true,
      condition: { field: 'operation', value: 'grafana_create_folder' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Grafana folder title based on the user's description.
The title should be:
- Clear and descriptive
- Indicate the category or scope of dashboards it will contain
- Concise (typically 1-3 words)

Examples:
- "production monitoring" -> Production
- "kubernetes dashboards" -> Kubernetes
- "team alpha metrics" -> Team Alpha

Return ONLY the folder title - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the folder...',
      },
    },
    {
      id: 'folderUidNew',
      title: 'Folder UID',
      type: 'short-input',
      placeholder: 'Optional - auto-generated if not provided',
      condition: { field: 'operation', value: 'grafana_create_folder' },
    },
    {
      id: 'parentUidNew',
      title: 'Parent Folder UID',
      type: 'short-input',
      placeholder: 'Optional - for nested folders',
      mode: 'advanced',
      condition: { field: 'operation', value: 'grafana_create_folder' },
    },
    {
      id: 'parentUidList',
      title: 'Parent Folder UID',
      type: 'short-input',
      placeholder: 'List children of this folder UID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'grafana_list_folders' },
    },
    {
      id: 'manageFolderUid',
      title: 'Folder UID',
      type: 'short-input',
      placeholder: 'Enter folder UID',
      required: true,
      condition: {
        field: 'operation',
        value: ['grafana_get_folder', 'grafana_update_folder', 'grafana_delete_folder'],
      },
    },
    {
      id: 'updateFolderTitle',
      title: 'New Folder Title',
      type: 'short-input',
      placeholder: 'Enter new folder title',
      required: { field: 'operation', value: 'grafana_update_folder' },
      condition: { field: 'operation', value: 'grafana_update_folder' },
    },
    {
      id: 'forceDeleteRules',
      title: 'Force Delete Alert Rules',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'grafana_delete_folder' },
    },

    {
      id: 'contactPointName',
      title: 'Contact Point Name',
      type: 'short-input',
      placeholder: 'Filter by exact name',
      mode: 'advanced',
      condition: { field: 'operation', value: 'grafana_list_contact_points' },
    },
    {
      id: 'contactPointNameNew',
      title: 'Contact Point Name',
      type: 'short-input',
      placeholder: 'Enter contact point name',
      required: true,
      condition: { field: 'operation', value: 'grafana_create_contact_point' },
    },
    {
      id: 'contactPointType',
      title: 'Type',
      type: 'dropdown',
      options: [
        { label: 'Slack', id: 'slack' },
        { label: 'Email', id: 'email' },
        { label: 'PagerDuty', id: 'pagerduty' },
        { label: 'Webhook', id: 'webhook' },
        { label: 'Microsoft Teams', id: 'teams' },
        { label: 'Opsgenie', id: 'opsgenie' },
        { label: 'Discord', id: 'discord' },
      ],
      value: () => 'slack',
      required: true,
      condition: { field: 'operation', value: 'grafana_create_contact_point' },
    },
    {
      id: 'contactPointSettings',
      title: 'Settings (JSON)',
      type: 'long-input',
      placeholder: 'JSON object of receiver settings (e.g., {"url":"https://hooks.slack.com/..."})',
      required: true,
      condition: { field: 'operation', value: 'grafana_create_contact_point' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Grafana contact point settings JSON object based on the user's description and receiver type.

Examples by type:
- slack -> {"recipient":"#alerts","url":"https://hooks.slack.com/services/XXX"}
- email -> {"addresses":"oncall@example.com;sre@example.com"}
- pagerduty -> {"integrationKey":"YOUR_INTEGRATION_KEY","severity":"critical"}
- webhook -> {"url":"https://example.com/hook","httpMethod":"POST"}

Return ONLY the JSON object - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the notification target...',
        generationType: 'json-object',
      },
    },
    {
      id: 'disableResolveMessage',
      title: 'Disable Resolve Message',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'grafana_create_contact_point' },
    },
  ],
  tools: {
    access: [
      'grafana_get_dashboard',
      'grafana_list_dashboards',
      'grafana_create_dashboard',
      'grafana_update_dashboard',
      'grafana_delete_dashboard',
      'grafana_list_alert_rules',
      'grafana_get_alert_rule',
      'grafana_create_alert_rule',
      'grafana_update_alert_rule',
      'grafana_delete_alert_rule',
      'grafana_list_contact_points',
      'grafana_create_contact_point',
      'grafana_create_annotation',
      'grafana_list_annotations',
      'grafana_update_annotation',
      'grafana_delete_annotation',
      'grafana_list_data_sources',
      'grafana_get_data_source',
      'grafana_check_data_source_health',
      'grafana_list_folders',
      'grafana_create_folder',
      'grafana_get_folder',
      'grafana_update_folder',
      'grafana_delete_folder',
      'grafana_get_health',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const result: Record<string, unknown> = {}
        switch (params.operation) {
          case 'grafana_list_dashboards':
            if (params.page) result.page = Number(params.page)
            if (params.limit) result.limit = Number(params.limit)
            break
          case 'grafana_create_alert_rule':
            if (params.alertTitle) result.title = params.alertTitle
            if (params.alertRuleUidNew) result.uid = params.alertRuleUidNew
            if (params.missingSeriesEvalsToResolve) {
              result.missingSeriesEvalsToResolve = Number(params.missingSeriesEvalsToResolve)
            }
            break
          case 'grafana_update_alert_rule':
            if (params.alertTitle) result.title = params.alertTitle
            if (params.missingSeriesEvalsToResolve) {
              result.missingSeriesEvalsToResolve = Number(params.missingSeriesEvalsToResolve)
            }
            break
          case 'grafana_list_contact_points':
            if (params.contactPointName) result.name = params.contactPointName
            break
          case 'grafana_create_contact_point':
            if (params.contactPointNameNew) result.name = params.contactPointNameNew
            if (params.contactPointType) result.type = params.contactPointType
            if (params.contactPointSettings) result.settings = params.contactPointSettings
            break
          case 'grafana_create_annotation':
            if (params.annotationTags) result.tags = params.annotationTags
            if (params.annotationDashboardUid) result.dashboardUid = params.annotationDashboardUid
            if (params.panelId) result.panelId = Number(params.panelId)
            if (params.time) result.time = Number(params.time)
            if (params.timeEnd) result.timeEnd = Number(params.timeEnd)
            break
          case 'grafana_update_annotation':
            if (params.annotationTags) result.tags = params.annotationTags
            if (params.annotationId) result.annotationId = Number(params.annotationId)
            if (params.time) result.time = Number(params.time)
            if (params.timeEnd) result.timeEnd = Number(params.timeEnd)
            break
          case 'grafana_delete_annotation':
            if (params.annotationId) result.annotationId = Number(params.annotationId)
            break
          case 'grafana_list_annotations':
            if (params.annotationTags) result.tags = params.annotationTags
            if (params.annotationDashboardUid) result.dashboardUid = params.annotationDashboardUid
            if (params.annotationType) result.type = params.annotationType
            if (params.panelId) result.panelId = Number(params.panelId)
            if (params.alertId) result.alertId = Number(params.alertId)
            if (params.userId) result.userId = Number(params.userId)
            if (params.from) result.from = Number(params.from)
            if (params.to) result.to = Number(params.to)
            if (params.limit) result.limit = Number(params.limit)
            break
          case 'grafana_list_folders':
            if (params.parentUidList) result.parentUid = params.parentUidList
            if (params.page) result.page = Number(params.page)
            if (params.limit) result.limit = Number(params.limit)
            break
          case 'grafana_create_folder':
            if (params.folderTitle) result.title = params.folderTitle
            if (params.folderUidNew) result.uid = params.folderUidNew
            if (params.parentUidNew) result.parentUid = params.parentUidNew
            break
          case 'grafana_get_folder':
          case 'grafana_delete_folder':
            if (params.manageFolderUid) result.folderUid = params.manageFolderUid
            break
          case 'grafana_update_folder':
            if (params.manageFolderUid) result.folderUid = params.manageFolderUid
            if (params.updateFolderTitle) result.title = params.updateFolderTitle
            break
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    baseUrl: { type: 'string', description: 'Grafana instance URL' },
    apiKey: { type: 'string', description: 'Service Account Token' },
    organizationId: { type: 'string', description: 'Organization ID (optional)' },
    dashboardUid: { type: 'string', description: 'Dashboard UID' },
    title: { type: 'string', description: 'Dashboard or folder title' },
    folderUid: { type: 'string', description: 'Folder UID' },
    tags: { type: 'string', description: 'Comma-separated tags' },
    panels: { type: 'string', description: 'JSON array of panels' },
    message: { type: 'string', description: 'Commit message' },
    query: { type: 'string', description: 'Search query' },
    tag: { type: 'string', description: 'Filter by tag' },
    folderUIDs: {
      type: 'string',
      description: 'Filter dashboards by folder UIDs (comma-separated)',
    },
    dashboardUIDs: { type: 'string', description: 'Filter by dashboard UIDs (comma-separated)' },
    page: { type: 'number', description: 'Page number for pagination' },
    limit: { type: 'number', description: 'Maximum number of results to return' },
    starred: { type: 'boolean', description: 'Only return starred dashboards' },
    alertRuleUid: { type: 'string', description: 'Alert rule UID' },
    alertRuleUidNew: { type: 'string', description: 'Custom UID for newly created alert rule' },
    alertTitle: { type: 'string', description: 'Alert rule title' },
    ruleGroup: { type: 'string', description: 'Rule group name' },
    condition: { type: 'string', description: 'Alert condition refId' },
    data: { type: 'string', description: 'Query data JSON' },
    forDuration: { type: 'string', description: 'Duration before firing' },
    noDataState: { type: 'string', description: 'State on no data' },
    execErrState: { type: 'string', description: 'State on error' },
    isPaused: { type: 'boolean', description: 'Whether the alert rule is paused' },
    keepFiringFor: {
      type: 'string',
      description: 'Duration to keep firing after the condition stops',
    },
    missingSeriesEvalsToResolve: {
      type: 'number',
      description: 'Missing series evaluations before resolving',
    },
    notificationSettings: {
      type: 'string',
      description: 'JSON of per-rule notification settings',
    },
    record: { type: 'string', description: 'JSON of recording rule configuration' },
    disableProvenance: {
      type: 'boolean',
      description: 'Disable provenance tracking so the rule remains UI-editable',
    },
    annotations: { type: 'string', description: 'JSON of alert annotations' },
    labels: { type: 'string', description: 'JSON of alert labels' },
    overwrite: { type: 'boolean', description: 'Overwrite existing dashboard on version conflict' },
    text: { type: 'string', description: 'Annotation text' },
    annotationId: { type: 'number', description: 'Annotation ID' },
    annotationTags: { type: 'string', description: 'Annotation tags (comma-separated)' },
    annotationDashboardUid: { type: 'string', description: 'Annotation dashboard UID' },
    panelId: { type: 'number', description: 'Panel ID' },
    time: { type: 'number', description: 'Start time (epoch ms)' },
    timeEnd: { type: 'number', description: 'End time (epoch ms)' },
    from: { type: 'number', description: 'Filter from time' },
    to: { type: 'number', description: 'Filter to time' },
    alertId: { type: 'number', description: 'Filter annotations by alert ID' },
    userId: { type: 'number', description: 'Filter annotations by creator user ID' },
    annotationType: {
      type: 'string',
      description: 'Filter annotations by type (alert or annotation)',
    },
    folderTitle: { type: 'string', description: 'Folder title for newly created folder' },
    folderUidNew: { type: 'string', description: 'Custom UID for newly created folder' },
    parentUidList: { type: 'string', description: 'Parent folder UID to list children of' },
    parentUidNew: { type: 'string', description: 'Parent folder UID for newly created folder' },
    manageFolderUid: { type: 'string', description: 'UID of the folder to get, update, or delete' },
    updateFolderTitle: { type: 'string', description: 'New title for the folder being updated' },
    forceDeleteRules: {
      type: 'boolean',
      description: 'Delete alert rules stored in the folder when deleting it',
    },
    contactPointName: { type: 'string', description: 'Filter contact points by name' },
    contactPointNameNew: { type: 'string', description: 'Name for the new contact point' },
    contactPointType: {
      type: 'string',
      description: 'Receiver type for the new contact point (e.g., slack, email)',
    },
    contactPointSettings: {
      type: 'string',
      description: 'JSON of receiver-specific settings for the new contact point',
    },
    disableResolveMessage: {
      type: 'boolean',
      description: 'Do not send a notification when the alert resolves',
    },
    dataSourceId: { type: 'string', description: 'Data source ID or UID' },
    dataSourceUid: { type: 'string', description: 'Data source UID for health checks' },
  },
  outputs: {
    version: { type: 'string', description: 'Grafana version' },
    database: { type: 'string', description: 'Database health status' },
    commit: { type: 'string', description: 'Git commit hash of the Grafana build' },
    status: { type: 'string', description: 'Health status (e.g., data source health)' },
    dashboard: { type: 'json', description: 'Dashboard JSON' },
    meta: { type: 'json', description: 'Dashboard metadata' },
    dashboards: { type: 'json', description: 'List of dashboards' },
    uid: { type: 'string', description: 'Created/updated UID' },
    url: { type: 'string', description: 'Dashboard URL' },
    rules: { type: 'json', description: 'Alert rules list' },
    contactPoints: { type: 'json', description: 'Contact points list' },
    name: { type: 'string', description: 'Name of the created contact point' },
    type: { type: 'string', description: 'Type of the created contact point' },
    settings: { type: 'json', description: 'Contact point receiver settings' },
    condition: { type: 'string', description: 'Alert condition refId' },
    for: { type: 'string', description: 'Duration the condition must hold before firing' },
    keepFiringFor: {
      type: 'string',
      description: 'Duration to keep firing after the condition stops',
    },
    missingSeriesEvalsToResolve: {
      type: 'number',
      description: 'Missing series evaluations before resolving',
    },
    isPaused: { type: 'boolean', description: 'Whether the alert rule is paused' },
    folderUID: { type: 'string', description: 'Parent folder UID' },
    ruleGroup: { type: 'string', description: 'Rule group name' },
    orgID: { type: 'number', description: 'Organization ID' },
    provenance: { type: 'string', description: 'Provisioning source' },
    noDataState: { type: 'string', description: 'State on no data' },
    execErrState: { type: 'string', description: 'State on execution error' },
    notification_settings: { type: 'json', description: 'Per-rule notification settings' },
    record: { type: 'json', description: 'Recording rule configuration' },
    updated: { type: 'string', description: 'Last update timestamp' },
    annotations: { type: 'json', description: 'Annotations list' },
    id: { type: 'number', description: 'Annotation ID' },
    dataSources: { type: 'json', description: 'Data sources list' },
    folders: { type: 'json', description: 'Folders list' },
    message: { type: 'string', description: 'Status message' },
  },
}
