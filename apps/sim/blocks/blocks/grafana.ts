import { GrafanaIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { GrafanaResponse } from '@/tools/grafana/types'

export const GrafanaBlock: BlockConfig<GrafanaResponse> = {
  type: 'grafana',
  name: 'Grafana',
  description: 'Interact with Grafana dashboards, alerts, and annotations',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Grafana into workflows. Manage dashboards, alerts, annotations, data sources, folders, and monitor health status.',
  docsLink: 'https://docs.sim.ai/tools/grafana',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: GrafanaIcon,
  subBlocks: [
    // Operation dropdown
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Dashboards
        { label: 'List Dashboards', id: 'grafana_list_dashboards' },
        { label: 'Get Dashboard', id: 'grafana_get_dashboard' },
        { label: 'Create Dashboard', id: 'grafana_create_dashboard' },
        { label: 'Update Dashboard', id: 'grafana_update_dashboard' },
        { label: 'Delete Dashboard', id: 'grafana_delete_dashboard' },
        // Alerts
        { label: 'List Alert Rules', id: 'grafana_list_alert_rules' },
        { label: 'Get Alert Rule', id: 'grafana_get_alert_rule' },
        { label: 'Create Alert Rule', id: 'grafana_create_alert_rule' },
        { label: 'Update Alert Rule', id: 'grafana_update_alert_rule' },
        { label: 'Delete Alert Rule', id: 'grafana_delete_alert_rule' },
        { label: 'List Contact Points', id: 'grafana_list_contact_points' },
        // Annotations
        { label: 'Create Annotation', id: 'grafana_create_annotation' },
        { label: 'List Annotations', id: 'grafana_list_annotations' },
        { label: 'Update Annotation', id: 'grafana_update_annotation' },
        { label: 'Delete Annotation', id: 'grafana_delete_annotation' },
        // Data Sources
        { label: 'List Data Sources', id: 'grafana_list_data_sources' },
        { label: 'Get Data Source', id: 'grafana_get_data_source' },
        // Folders
        { label: 'List Folders', id: 'grafana_list_folders' },
        { label: 'Create Folder', id: 'grafana_create_folder' },
      ],
      value: () => 'grafana_list_dashboards',
    },

    // Base Configuration (common to all operations)
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

    // Data Source operations
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

    // Dashboard operations
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
    },
    {
      id: 'tag',
      title: 'Filter by Tag',
      type: 'short-input',
      placeholder: 'tag1, tag2 (comma-separated)',
      condition: { field: 'operation', value: 'grafana_list_dashboards' },
    },

    // Create/Update Dashboard
    {
      id: 'title',
      title: 'Dashboard Title',
      type: 'short-input',
      placeholder: 'Enter dashboard title',
      required: true,
      condition: { field: 'operation', value: 'grafana_create_dashboard' },
    },
    {
      id: 'folderUid',
      title: 'Folder UID',
      type: 'short-input',
      placeholder: 'Optional - folder to create dashboard in',
      condition: {
        field: 'operation',
        value: [
          'grafana_create_dashboard',
          'grafana_update_dashboard',
          'grafana_create_alert_rule',
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

    // Alert Rule operations
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
      condition: {
        field: 'operation',
        value: ['grafana_create_alert_rule', 'grafana_update_alert_rule'],
      },
    },
    {
      id: 'folderUid',
      title: 'Folder UID',
      type: 'short-input',
      placeholder: 'Folder UID for the alert rule',
      condition: {
        field: 'operation',
        value: ['grafana_create_alert_rule', 'grafana_update_alert_rule'],
      },
    },
    {
      id: 'ruleGroup',
      title: 'Rule Group',
      type: 'short-input',
      placeholder: 'Enter rule group name',
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
      condition: {
        field: 'operation',
        value: ['grafana_create_alert_rule', 'grafana_update_alert_rule'],
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
        { label: 'Alerting', id: 'Alerting' },
        { label: 'OK', id: 'OK' },
      ],
      value: () => 'Alerting',
      condition: {
        field: 'operation',
        value: ['grafana_create_alert_rule', 'grafana_update_alert_rule'],
      },
    },

    // Annotation operations
    {
      id: 'text',
      title: 'Annotation Text',
      type: 'long-input',
      placeholder: 'Enter annotation text...',
      required: true,
      condition: {
        field: 'operation',
        value: ['grafana_create_annotation', 'grafana_update_annotation'],
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
      placeholder: 'Enter dashboard UID',
      required: true,
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
      id: 'time',
      title: 'Time (epoch ms)',
      type: 'short-input',
      placeholder: 'Optional - defaults to now',
      condition: {
        field: 'operation',
        value: ['grafana_create_annotation', 'grafana_update_annotation'],
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
    },
    {
      id: 'to',
      title: 'To Time (epoch ms)',
      type: 'short-input',
      placeholder: 'Filter to time',
      condition: { field: 'operation', value: 'grafana_list_annotations' },
    },

    // Folder operations
    {
      id: 'folderTitle',
      title: 'Folder Title',
      type: 'short-input',
      placeholder: 'Enter folder title',
      required: true,
      condition: { field: 'operation', value: 'grafana_create_folder' },
    },
    {
      id: 'folderUidNew',
      title: 'Folder UID',
      type: 'short-input',
      placeholder: 'Optional - auto-generated if not provided',
      condition: { field: 'operation', value: 'grafana_create_folder' },
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
      'grafana_create_annotation',
      'grafana_list_annotations',
      'grafana_update_annotation',
      'grafana_delete_annotation',
      'grafana_list_data_sources',
      'grafana_get_data_source',
      'grafana_list_folders',
      'grafana_create_folder',
    ],
    config: {
      tool: (params) => {
        // Convert numeric string fields to numbers
        if (params.panelId) {
          params.panelId = Number(params.panelId)
        }
        if (params.annotationId) {
          params.annotationId = Number(params.annotationId)
        }
        if (params.time) {
          params.time = Number(params.time)
        }
        if (params.timeEnd) {
          params.timeEnd = Number(params.timeEnd)
        }
        if (params.from) {
          params.from = Number(params.from)
        }
        if (params.to) {
          params.to = Number(params.to)
        }

        // Map subblock fields to tool parameter names
        if (params.alertTitle) {
          params.title = params.alertTitle
        }
        if (params.folderTitle) {
          params.title = params.folderTitle
        }
        if (params.folderUidNew) {
          params.uid = params.folderUidNew
        }
        if (params.annotationTags) {
          params.tags = params.annotationTags
        }
        if (params.annotationDashboardUid) {
          params.dashboardUid = params.annotationDashboardUid
        }

        return params.operation
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    baseUrl: { type: 'string', description: 'Grafana instance URL' },
    apiKey: { type: 'string', description: 'Service Account Token' },
    organizationId: { type: 'string', description: 'Organization ID (optional)' },
    // Dashboard inputs
    dashboardUid: { type: 'string', description: 'Dashboard UID' },
    title: { type: 'string', description: 'Dashboard or folder title' },
    folderUid: { type: 'string', description: 'Folder UID' },
    tags: { type: 'string', description: 'Comma-separated tags' },
    panels: { type: 'string', description: 'JSON array of panels' },
    message: { type: 'string', description: 'Commit message' },
    query: { type: 'string', description: 'Search query' },
    tag: { type: 'string', description: 'Filter by tag' },
    // Alert inputs
    alertRuleUid: { type: 'string', description: 'Alert rule UID' },
    alertTitle: { type: 'string', description: 'Alert rule title' },
    ruleGroup: { type: 'string', description: 'Rule group name' },
    condition: { type: 'string', description: 'Alert condition refId' },
    data: { type: 'string', description: 'Query data JSON' },
    forDuration: { type: 'string', description: 'Duration before firing' },
    noDataState: { type: 'string', description: 'State on no data' },
    execErrState: { type: 'string', description: 'State on error' },
    // Annotation inputs
    text: { type: 'string', description: 'Annotation text' },
    annotationId: { type: 'number', description: 'Annotation ID' },
    panelId: { type: 'number', description: 'Panel ID' },
    time: { type: 'number', description: 'Start time (epoch ms)' },
    timeEnd: { type: 'number', description: 'End time (epoch ms)' },
    from: { type: 'number', description: 'Filter from time' },
    to: { type: 'number', description: 'Filter to time' },
    // Data source inputs
    dataSourceId: { type: 'string', description: 'Data source ID or UID' },
  },
  outputs: {
    // Health outputs
    version: { type: 'string', description: 'Grafana version' },
    database: { type: 'string', description: 'Database health status' },
    status: { type: 'string', description: 'Health status' },
    // Dashboard outputs
    dashboard: { type: 'json', description: 'Dashboard JSON' },
    meta: { type: 'json', description: 'Dashboard metadata' },
    dashboards: { type: 'json', description: 'List of dashboards' },
    uid: { type: 'string', description: 'Created/updated UID' },
    url: { type: 'string', description: 'Dashboard URL' },
    // Alert outputs
    rules: { type: 'json', description: 'Alert rules list' },
    contactPoints: { type: 'json', description: 'Contact points list' },
    // Annotation outputs
    annotations: { type: 'json', description: 'Annotations list' },
    id: { type: 'number', description: 'Annotation ID' },
    // Data source outputs
    dataSources: { type: 'json', description: 'Data sources list' },
    // Folder outputs
    folders: { type: 'json', description: 'Folders list' },
    // Common
    message: { type: 'string', description: 'Status message' },
  },
}
