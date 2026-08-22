import { GrafanaIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { GrafanaResponse } from '@/tools/grafana/types'

export const GrafanaBlock: BlockConfig<GrafanaResponse> = {
  type: 'grafana',
  name: 'Grafana',
  description: 'Interact with Grafana dashboards, alerts, and annotations',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Grafana into workflows. Manage dashboards, alerts, annotations, data sources, folders, and monitor health status.',
  docsLink: 'https://docs.sim.ai/integrations/grafana',
  category: 'tools',
  integrationType: IntegrationType.Observability,
  bgColor: '#FFFFFF',
  icon: GrafanaIcon,
  canvasPresentation: {
    defaultTitle: 'Grafana',
    sentences: {
      byOperation: {
        grafana_list_dashboards: [
          'List dashboards',
          { text: ', matching', field: 'query' },
          { text: ', tagged', field: 'tag' },
          { text: ', in folders', field: 'folderUIDs' },
        ],
        grafana_get_dashboard: [{ text: 'Fetch dashboard', field: 'dashboardUid', core: true }],
        grafana_create_dashboard: [
          { text: 'Create dashboard', field: 'title', core: true },
          { text: ', in folder', field: 'folderUid' },
          { text: ', tagged', field: 'tags' },
        ],
        grafana_update_dashboard: [
          { text: 'Update dashboard', field: 'dashboardUid', core: true },
          { text: ', setting panels to', field: 'panels' },
          { text: ', moving it to folder', field: 'folderUid' },
        ],
        grafana_delete_dashboard: [{ text: 'Delete dashboard', field: 'dashboardUid', core: true }],
        grafana_list_alert_rules: ['List all alert rules'],
        grafana_get_alert_rule: [{ text: 'Fetch alert rule', field: 'alertRuleUid', core: true }],
        grafana_create_alert_rule: [
          { text: 'Create alert rule', field: 'alertTitle', core: true },
          { text: ', in group', field: 'ruleGroup' },
          { text: ', firing after', field: 'forDuration' },
        ],
        grafana_update_alert_rule: [
          { text: 'Update alert rule', field: 'alertRuleUid', core: true },
          { text: ', renaming it to', field: 'alertTitle' },
          { text: ', firing after', field: 'forDuration' },
        ],
        grafana_delete_alert_rule: [
          { text: 'Delete alert rule', field: 'alertRuleUid', core: true },
        ],
        grafana_query_data_source: ['Query a data source', { text: ', over', field: 'queryFrom' }],
        grafana_list_contact_points: [
          'List contact points',
          { text: ', named', field: 'contactPointName' },
        ],
        grafana_create_contact_point: [
          { text: 'Create contact point', field: 'contactPointNameNew', core: true },
          { text: ', of type', field: 'contactPointType' },
        ],
        grafana_update_contact_point: [
          { text: 'Replace contact point', field: 'contactPointUid', core: true },
          { text: ', as type', field: 'contactPointType' },
        ],
        grafana_delete_contact_point: [
          { text: 'Delete contact point', field: 'contactPointUid', core: true },
        ],
        grafana_move_folder: [
          { text: 'Move folder', field: 'manageFolderUid', core: true },
          { text: ', under', field: 'newParentUid' },
        ],
        grafana_get_alert_rule_group: [
          { text: 'Read alert rule group', field: 'ruleGroupName', core: true },
          { text: ', in folder', field: 'manageFolderUid' },
        ],
        grafana_create_annotation: [
          { text: 'Create annotation', field: 'text', core: true },
          { text: ', on dashboard', field: 'annotationDashboardUid' },
          { text: ', tagged', field: 'annotationTags' },
        ],
        grafana_list_annotations: [
          'List annotations',
          { text: ', on dashboard', field: 'annotationDashboardUid' },
          { text: ', tagged', field: 'annotationTags' },
          { text: ', since', field: 'from' },
        ],
        grafana_update_annotation: [
          { text: 'Update annotation', field: 'annotationId', core: true },
          { text: ', setting text to', field: 'text' },
          { text: ', tagged', field: 'annotationTags' },
        ],
        grafana_delete_annotation: [
          { text: 'Delete annotation', field: 'annotationId', core: true },
        ],
        grafana_list_data_sources: ['List all data sources'],
        grafana_get_data_source: [{ text: 'Fetch data source', field: 'dataSourceId', core: true }],
        grafana_check_data_source_health: [
          { text: 'Test connectivity to data source', field: 'dataSourceUid', core: true },
        ],
        grafana_list_folders: ['List folders', { text: ', under parent', field: 'parentUidList' }],
        grafana_create_folder: [
          { text: 'Create folder', field: 'folderTitle', core: true },
          { text: ', under parent', field: 'parentUidNew' },
        ],
        grafana_get_folder: [{ text: 'Fetch folder', field: 'manageFolderUid', core: true }],
        grafana_update_folder: [
          { text: 'Rename folder', field: 'manageFolderUid', core: true },
          { text: 'to', field: 'updateFolderTitle' },
        ],
        grafana_delete_folder: [{ text: 'Delete folder', field: 'manageFolderUid', core: true }],
        grafana_get_health: ['Report instance health and version'],
      },
    },
  },
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
        { label: 'Get Alert Rule Group', id: 'grafana_get_alert_rule_group' },
        { label: 'Create Alert Rule', id: 'grafana_create_alert_rule' },
        { label: 'Update Alert Rule', id: 'grafana_update_alert_rule' },
        { label: 'Delete Alert Rule', id: 'grafana_delete_alert_rule' },
        { label: 'List Contact Points', id: 'grafana_list_contact_points' },
        { label: 'Create Contact Point', id: 'grafana_create_contact_point' },
        { label: 'Update Contact Point', id: 'grafana_update_contact_point' },
        { label: 'Delete Contact Point', id: 'grafana_delete_contact_point' },
        { label: 'Create Annotation', id: 'grafana_create_annotation' },
        { label: 'List Annotations', id: 'grafana_list_annotations' },
        { label: 'Update Annotation', id: 'grafana_update_annotation' },
        { label: 'Delete Annotation', id: 'grafana_delete_annotation' },
        { label: 'List Data Sources', id: 'grafana_list_data_sources' },
        { label: 'Get Data Source', id: 'grafana_get_data_source' },
        { label: 'Query Data Source', id: 'grafana_query_data_source' },
        { label: 'Check Data Source Health', id: 'grafana_check_data_source_health' },
        { label: 'List Folders', id: 'grafana_list_folders' },
        { label: 'Create Folder', id: 'grafana_create_folder' },
        { label: 'Get Folder', id: 'grafana_get_folder' },
        { label: 'Update Folder', id: 'grafana_update_folder' },
        { label: 'Delete Folder', id: 'grafana_delete_folder' },
        { label: 'Move Folder', id: 'grafana_move_folder' },
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
      /** Update accepts a new title too, but only create demands one. */
      required: { field: 'operation', value: 'grafana_create_dashboard' },
      condition: {
        field: 'operation',
        value: ['grafana_create_dashboard', 'grafana_update_dashboard'],
      },
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
          'grafana_update_contact_point',
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
        value: [
          'grafana_get_folder',
          'grafana_update_folder',
          'grafana_delete_folder',
          'grafana_move_folder',
          'grafana_get_alert_rule_group',
        ],
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
      id: 'dataSourceQueries',
      title: 'Queries (JSON)',
      type: 'long-input',
      placeholder: '[{"refId":"A","datasource":{"uid":"P123"},"expr":"up","format":"time_series"}]',
      required: { field: 'operation', value: 'grafana_query_data_source' },
      condition: { field: 'operation', value: 'grafana_query_data_source' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Grafana /api/ds/query queries array based on the user's request.

Rules:
- Always a JSON array with at least one query object
- Every query needs a refId (e.g. "A") and datasource.uid
- Add the fields that data source expects: expr for Prometheus/Loki, rawSql for SQL sources
- format is "time_series" or "table"

Examples:
- [{"refId":"A","datasource":{"uid":"PROM_UID"},"expr":"rate(http_requests_total[5m])","format":"time_series"}]
- [{"refId":"A","datasource":{"uid":"PG_UID"},"rawSql":"SELECT now() AS time, count(*) AS c FROM orders","format":"table"}]

Return ONLY the JSON array - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the metric or query you want...',
        generationType: 'json-array',
      },
    },
    {
      id: 'queryFrom',
      title: 'From',
      type: 'short-input',
      placeholder: 'now-1h or epoch milliseconds',
      condition: { field: 'operation', value: 'grafana_query_data_source' },
    },
    {
      id: 'queryTo',
      title: 'To',
      type: 'short-input',
      placeholder: 'now or epoch milliseconds',
      mode: 'advanced',
      condition: { field: 'operation', value: 'grafana_query_data_source' },
    },
    {
      id: 'contactPointUid',
      title: 'Contact Point UID',
      type: 'short-input',
      placeholder: 'Enter contact point UID',
      required: {
        field: 'operation',
        value: ['grafana_update_contact_point', 'grafana_delete_contact_point'],
      },
      condition: {
        field: 'operation',
        value: ['grafana_update_contact_point', 'grafana_delete_contact_point'],
      },
    },
    {
      id: 'newParentUid',
      title: 'New Parent Folder UID',
      type: 'short-input',
      placeholder: 'Leave empty to move to the root',
      condition: { field: 'operation', value: 'grafana_move_folder' },
    },
    {
      id: 'ruleGroupName',
      title: 'Rule Group',
      type: 'short-input',
      placeholder: 'Enter rule group name',
      required: { field: 'operation', value: 'grafana_get_alert_rule_group' },
      condition: { field: 'operation', value: 'grafana_get_alert_rule_group' },
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
      required: {
        field: 'operation',
        value: ['grafana_create_contact_point', 'grafana_update_contact_point'],
      },
      condition: {
        field: 'operation',
        value: ['grafana_create_contact_point', 'grafana_update_contact_point'],
      },
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
      required: {
        field: 'operation',
        value: ['grafana_create_contact_point', 'grafana_update_contact_point'],
      },
      condition: {
        field: 'operation',
        value: ['grafana_create_contact_point', 'grafana_update_contact_point'],
      },
    },
    {
      id: 'contactPointSettings',
      title: 'Settings (JSON)',
      type: 'long-input',
      placeholder: 'JSON object of receiver settings (e.g., {"url":"https://hooks.slack.com/..."})',
      required: true,
      condition: {
        field: 'operation',
        value: ['grafana_create_contact_point', 'grafana_update_contact_point'],
      },
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
      condition: {
        field: 'operation',
        value: ['grafana_create_contact_point', 'grafana_update_contact_point'],
      },
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
      'grafana_update_contact_point',
      'grafana_delete_contact_point',
      'grafana_move_folder',
      'grafana_get_alert_rule_group',
      'grafana_query_data_source',
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
          case 'grafana_update_contact_point':
            if (params.contactPointNameNew) result.name = params.contactPointNameNew
            if (params.contactPointType) result.type = params.contactPointType
            if (params.contactPointSettings) result.settings = params.contactPointSettings
            break
          case 'grafana_query_data_source':
            result.queries = params.dataSourceQueries
            if (params.queryFrom) result.from = params.queryFrom
            if (params.queryTo) result.to = params.queryTo
            break
          case 'grafana_move_folder':
            result.folderUid = params.manageFolderUid
            result.parentUid = params.newParentUid ?? ''
            break
          case 'grafana_get_alert_rule_group':
            result.folderUid = params.manageFolderUid
            result.ruleGroup = params.ruleGroupName
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
    dataSourceQueries: { type: 'string', description: 'JSON array of data source queries' },
    queryFrom: { type: 'string', description: 'Query range start, relative or epoch ms' },
    queryTo: { type: 'string', description: 'Query range end, relative or epoch ms' },
    contactPointUid: {
      type: 'string',
      description: 'UID of the contact point to update or delete',
    },
    newParentUid: {
      type: 'string',
      description: 'UID of the new parent folder, empty for the root',
    },
    ruleGroupName: { type: 'string', description: 'Name of the alert rule group' },
    operation: { type: 'string', description: 'Operation to perform' },
    baseUrl: { type: 'string', description: 'Grafana instance URL' },
    apiKey: { type: 'string', description: 'Service Account Token' },
    organizationId: { type: 'string', description: 'Organization ID (optional)' },
    dashboardUid: { type: 'string', description: 'Dashboard UID' },
    title: { type: 'string', description: 'Dashboard or folder title' },
    folderUid: { type: 'string', description: 'Folder UID' },
    tags: { type: 'string', description: 'Comma-separated tags' },
    panels: { type: 'string', description: 'JSON array of panels' },
    message: {
      type: 'string',
      description:
        'Message returned by Grafana — a confirmation for writes, or the diagnostic detail on a health check',
    },
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
    record: {
      type: 'string',
      description: 'Recording rule configuration (metric, from, target_datasource_uid)',
    },
    disableProvenance: {
      type: 'boolean',
      description: 'Disable provenance tracking so the rule remains UI-editable',
    },
    annotations: {
      type: 'string',
      description:
        'For annotation operations, the matched annotations (id, dashboardUID, panelId, time, timeEnd, text, tags, newState, prevState, ...). For alert rules, the rule annotation map (summary, description, runbook_url)',
    },
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
    annotationId: {
      type: 'number',
      description:
        'The annotation that was updated, echoed from the request — Grafana answers a patch with only a message',
    },
    details: {
      type: 'json',
      description:
        'Extra structured detail from a data source health check, when the plugin supplies any',
    },
    results: {
      type: 'json',
      description: 'Raw data source query response, keyed by query refId',
    },
    series: {
      type: 'array',
      description:
        'Query frames flattened into rows (refId, fields, rowCount, rows) so values can be read directly',
    },
    interval: {
      type: 'number',
      description: 'Evaluation interval of an alert rule group, in seconds',
    },
    folderUid: { type: 'string', description: 'UID of the folder holding the alert rule group' },
    title: {
      type: 'string',
      description: 'Title of the affected dashboard, folder, or alert rule',
    },
    slug: { type: 'string', description: 'URL slug of the dashboard' },
    data: {
      type: 'json',
      description: 'Alert rule query and expression stages (refId, model, ...)',
    },
    labels: { type: 'json', description: 'Alert rule labels used for routing and grouping' },
    parentUid: { type: 'string', description: 'UID of the parent folder, when nested' },
    parents: {
      type: 'array',
      description: 'Folder ancestry from the root down to the parent (uid, title, url)',
    },
    created: { type: 'string', description: 'Creation timestamp of the folder' },
    createdBy: { type: 'string', description: 'Login that created the folder' },
    updatedBy: { type: 'string', description: 'Login that last updated the folder' },
    hasAcl: {
      type: 'boolean',
      description: 'Whether the folder carries an explicit permission list',
    },
    canSave: { type: 'boolean', description: 'Whether the caller may save the folder' },
    canEdit: { type: 'boolean', description: 'Whether the caller may edit the folder' },
    canAdmin: { type: 'boolean', description: 'Whether the caller may administer the folder' },
    orgId: { type: 'number', description: 'Organization the data source belongs to' },
    access: { type: 'string', description: 'Data source access mode (proxy or direct)' },
    user: { type: 'string', description: 'Data source basic-auth-adjacent user field' },
    typeLogoUrl: { type: 'string', description: 'Logo URL for the data source type' },
    basicAuth: { type: 'boolean', description: 'Whether the data source uses basic auth' },
    basicAuthUser: { type: 'string', description: 'Basic-auth user for the data source' },
    withCredentials: {
      type: 'boolean',
      description: 'Whether the data source sends credentials cross-origin',
    },
    isDefault: { type: 'boolean', description: 'Whether this is the default data source' },
    jsonData: { type: 'json', description: 'Non-secret data source configuration' },
    secureJsonFields: {
      type: 'json',
      description: 'Which secret data source fields are set (names only, never values)',
    },
    readOnly: { type: 'boolean', description: 'Whether the data source is provisioned read-only' },
    disableResolveMessage: {
      type: 'boolean',
      description: 'Whether the contact point suppresses resolve notifications',
    },
    version: {
      type: 'number',
      description:
        'Revision number of the dashboard, folder, or data source. Get Health instead returns the Grafana version as a string',
    },
    database: {
      type: 'string',
      description:
        'Database name of the data source; for Get Health, the Grafana database status (e.g. ok)',
    },
    commit: { type: 'string', description: 'Git commit hash of the Grafana build' },
    status: {
      type: 'string',
      description:
        'Outcome reported by Grafana — a data source health verdict, or the save status of a dashboard write',
    },
    dashboard: {
      type: 'json',
      description: 'Full dashboard JSON as stored by Grafana (panels, templating, time, ...)',
    },
    meta: {
      type: 'json',
      description: 'Dashboard metadata (isStarred, url, folderId, folderUid, slug)',
    },
    dashboards: {
      type: 'array',
      description:
        'Matched dashboards (id, uid, title, uri, url, type, tags, isStarred, folderId, folderUid, folderTitle, folderUrl)',
    },
    uid: {
      type: 'string',
      description:
        'UID of the affected resource — dashboard, folder, alert rule, data source, or contact point, depending on the operation',
    },
    url: {
      type: 'string',
      description: 'URL of the affected dashboard or folder; the connection URL for a data source',
    },
    rules: {
      type: 'array',
      description:
        'Provisioned alert rules (uid, title, folderUID, ruleGroup, condition, data, for, labels, annotations, isPaused, noDataState, execErrState, provenance, ...)',
    },
    contactPoints: {
      type: 'array',
      description: 'Contact points (uid, name, type, settings, disableResolveMessage, provenance)',
    },
    name: { type: 'string', description: 'Name of the affected contact point or data source' },
    type: {
      type: 'string',
      description:
        'Type of the affected contact point (e.g. slack) or data source (e.g. prometheus)',
    },
    settings: {
      type: 'json',
      description:
        'Contact point receiver settings — the shape depends on the receiver type, e.g. url and recipient for a Slack receiver',
    },
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
    annotations: { type: 'array', description: 'Annotations list' },
    id: {
      type: 'number',
      description:
        'Numeric id of the affected resource — annotation, alert rule, dashboard, folder, or data source, depending on the operation',
    },
    dataSources: {
      type: 'array',
      description:
        'Data sources (id, uid, orgId, name, type, typeLogoUrl, access, url, database, isDefault, jsonData, readOnly, ...)',
    },
    folders: {
      type: 'array',
      description: 'Folders (id, uid, title, and parentUid when nested folders are enabled)',
    },
    message: { type: 'string', description: 'Status message' },
  },
}

export const GrafanaBlockMeta = {
  tags: ['monitoring', 'data-analytics'],
  url: 'https://grafana.com',
  templates: [
    {
      icon: GrafanaIcon,
      title: 'Grafana alert auto-context',
      prompt:
        'Build a scheduled workflow that reads Grafana alert-state annotations to find rules that just started firing, queries the underlying data source for the current metric value, summarizes the two together with an agent, and posts the enriched alert to PagerDuty and Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['pagerduty', 'slack'],
    },
    {
      icon: GrafanaIcon,
      title: 'Grafana SLO scorecard',
      prompt:
        'Create a scheduled weekly workflow that runs SLI queries against a Grafana data source for each service, calculates error budget burn rates from the returned series, and writes a scorecard to a tables-based SRE review board.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
    },
    {
      icon: GrafanaIcon,
      title: 'Grafana dashboard auditor',
      prompt:
        'Build a scheduled workflow that scans Grafana dashboards monthly for broken panels, unused dashboards, and missing alerts, and writes a cleanup queue for the platform team.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
    },
    {
      icon: GrafanaIcon,
      title: 'Grafana metric export',
      prompt:
        'Create a workflow that runs a set of Grafana data source queries on schedule and writes the returned series into a Sim table, so the metrics can be combined with business data for unified reporting.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['analysis', 'sync'],
    },
    {
      icon: GrafanaIcon,
      title: 'Grafana incident annotator',
      prompt:
        'Build a scheduled workflow that polls PagerDuty for new incidents and adds Grafana annotations to relevant dashboards with the incident link, so engineers can see the context immediately on the timeline.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: GrafanaIcon,
      title: 'Grafana on-call digest',
      prompt:
        'Create a scheduled daily workflow that summarizes the past 24 hours of Grafana alerts by service and severity, and posts an on-call digest to Slack each morning.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GrafanaIcon,
      title: 'Grafana + Linear feature-impact',
      prompt:
        'Build a scheduled workflow that queries a Grafana data source for latency and error rates, compares each series against the prior period to spot regressions, correlates them with recent Linear releases, and posts a regression review to the team Slack with the suspected change.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
      alsoIntegrations: ['linear', 'slack'],
    },
  ],
  skills: [
    {
      name: 'annotate-deploy',
      description:
        'Create a Grafana annotation marking a deploy or incident so it shows on dashboards.',
      content:
        '# Annotate Deploy\n\nMark a deploy, release, or incident on Grafana dashboards for correlation.\n\n## Steps\n1. Build the annotation text (e.g. version, PR link, who triggered it) and tags for filtering.\n2. Create an annotation with the event time, or a time range for incidents with a start and end.\n3. Optionally scope the annotation to a specific dashboard so it appears only there.\n4. List annotations for the window to confirm it was recorded.\n\n## Output\nReturn the annotation ID, time, and tags. Useful for correlating metric changes with deploys later.',
    },
    {
      name: 'review-firing-alerts',
      description:
        'List Grafana alert rules and surface those currently firing with their contact points.',
      content:
        "# Review Firing Alerts\n\nProduce a snapshot of alerting health for an on-call handoff or incident triage.\n\n## Steps\n1. Run List Annotations with `type: 'alert'` over the window you care about. Alert-state transitions are recorded as annotations and carry `newState` and `prevState`, which is how you find what actually fired — the alert rule operations return rule *definitions*, never live instance state.\n2. Run List Alert Rules to join each firing rule id back to its title, folder, condition, and labels.\n3. Optionally run Query Data Source on the rule's own query to see how far the metric is from its threshold right now.\n4. Run List Contact Points, and Get Alert Rule Group for the evaluation interval, so each firing rule maps to who gets notified and how often it is checked.\n5. Group findings by severity label or folder.\n\n## Output\nReturn the rules that transitioned into a firing state in the window, each with its title, the transition, its notification target, and its group evaluation interval. Say explicitly that this is derived from state-change annotations rather than a live instance snapshot, and give the window covered.",
    },
    {
      name: 'audit-dashboards',
      description: 'List Grafana dashboards and folders and report data sources each depends on.',
      content:
        '# Audit Dashboards\n\nInventory dashboards and the data sources they rely on.\n\n## Steps\n1. List folders and dashboards to build the full inventory.\n2. Get details for each dashboard of interest to read its panels and referenced data sources.\n3. List data sources, then check the health of each one to flag dashboards pointing at unreachable or deprecated sources.\n\n## Output\nReturn an inventory grouped by folder, each dashboard with its UID and the data sources it uses, plus a flagged list of dashboards whose data sources failed their health check.',
    },
    {
      name: 'provision-monitoring-folder',
      description:
        'Create a Grafana folder and seed it with a starter dashboard for a new service or team.',
      content:
        '# Provision Monitoring Folder\n\nSet up an organized monitoring home for a new service or team.\n\n## Steps\n1. Create a folder with a descriptive title for the service or team.\n2. List data sources and pick the one the new dashboard should query.\n3. Create a dashboard inside the folder with starter panels for the key metrics.\n4. Get the dashboard back to confirm it was created in the right folder.\n\n## Output\nReturn the folder UID and the new dashboard UID and link. Note the data source the dashboard was wired to.',
    },
    {
      name: 'provision-alerting',
      description:
        'Stand up a Grafana alert rule and the contact point it notifies for a new service.',
      content:
        '# Provision Alerting\n\nWire up end-to-end alerting for a service: a notification target plus the rule that fires to it.\n\n## Steps\n1. List existing contact points to avoid duplicating one.\n2. Create a contact point for the destination (Slack, email, or PagerDuty) with its settings.\n3. Create an alert rule in the target folder with the query data, condition, and for-duration.\n4. Get the alert rule back to confirm it was created and is not paused.\n\n## Output\nReturn the new contact point UID and alert rule UID, with the data source and threshold the rule evaluates.',
    },
  ],
} as const satisfies BlockMeta
