import { NetSuiteIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { OciMonitoringResponse } from '@/tools/oci_monitoring/types'

const NAMESPACE_FIELD = ['namespaceSelector', 'namespaceInput'] as const
const ALARM_FIELD = ['alarmIdSelector', 'alarmIdInput'] as const
const SUPPRESSION_FIELD = ['alarmSuppressionIdSelector', 'alarmSuppressionIdInput'] as const

export const OciMonitoringBlock: BlockConfig<OciMonitoringResponse> = {
  type: 'oci_monitoring',
  name: 'OCI Monitoring',
  description: 'Discover and query metrics, publish custom metrics, and manage OCI alarms',
  longDescription:
    'Connect a reusable OCI API signing-key credential to discover metrics, run MQL queries, publish custom metrics, and manage alarms and maintenance suppressions. Reads and histories return one bounded page; queries expose explicit stream and datapoint budgets. Alarm destinations reference existing Notifications topics or Streaming streams. IAM policies must grant the selected operations in the alarm and metric compartments; creating and updating alarms also require metric-read access. Use the separate OCI Logging integration for logs.',
  category: 'tools',
  integrationType: IntegrationType.Observability,
  authMode: AuthMode.ApiKey,
  docsLink: 'https://docs.sim.ai/integrations/oci_monitoring',
  bgColor: '#FFFFFF',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'OCI Monitoring',
    sentences: {
      byOperation: {
        list_metrics: ['List metrics', { text: 'in namespace', field: NAMESPACE_FIELD }],
        summarize_metrics_data: [{ text: 'Query metrics in', field: NAMESPACE_FIELD, core: true }],
        post_metric_data: ['Publish metrics'],
        list_alarms: [{ text: 'List alarms in', field: 'compartmentId', core: true }],
        list_alarms_status: ['List alarm statuses', { text: 'matching', field: 'status' }],
        get_alarm: [{ text: 'Get alarm', field: ALARM_FIELD, core: true }],
        get_alarm_history: [{ text: 'Read history for', field: ALARM_FIELD, core: true }],
        retrieve_dimension_states: [
          { text: 'Inspect dimension states for', field: ALARM_FIELD, core: true },
        ],
        create_alarm: [{ text: 'Create alarm', field: 'displayName', core: true }],
        update_alarm: [{ text: 'Update alarm', field: ALARM_FIELD, core: true }],
        delete_alarm: [{ text: 'Delete alarm', field: ALARM_FIELD, core: true }],
        create_alarm_suppression: [{ text: 'Suppress alarm', field: ALARM_FIELD, core: true }],
        list_alarm_suppressions: [
          { text: 'List suppressions for', field: ALARM_FIELD, core: true },
        ],
        get_alarm_suppression: [{ text: 'Get suppression', field: SUPPRESSION_FIELD, core: true }],
        delete_alarm_suppression: [
          { text: 'Delete suppression', field: SUPPRESSION_FIELD, core: true },
        ],
        summarize_alarm_suppression_history: [
          { text: 'Read suppression history for', field: ALARM_FIELD, core: true },
        ],
        remove_alarm_suppression: [
          { text: 'Remove inline suppression from', field: ALARM_FIELD, core: true },
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
        { label: 'List Metrics', id: 'list_metrics' },
        { label: 'Query Metrics', id: 'summarize_metrics_data' },
        { label: 'Publish Metrics', id: 'post_metric_data' },
        { label: 'List Alarms', id: 'list_alarms' },
        { label: 'List Alarm Statuses', id: 'list_alarms_status' },
        { label: 'Get Alarm', id: 'get_alarm' },
        { label: 'Get Alarm History', id: 'get_alarm_history' },
        { label: 'Get Dimension States', id: 'retrieve_dimension_states' },
        { label: 'Create Alarm', id: 'create_alarm' },
        { label: 'Update Alarm', id: 'update_alarm' },
        { label: 'Delete Alarm', id: 'delete_alarm' },
        { label: 'Create Alarm Suppression', id: 'create_alarm_suppression' },
        { label: 'List Alarm Suppressions', id: 'list_alarm_suppressions' },
        { label: 'Get Alarm Suppression', id: 'get_alarm_suppression' },
        { label: 'Delete Alarm Suppression', id: 'delete_alarm_suppression' },
        { label: 'Get Suppression History', id: 'summarize_alarm_suppression_history' },
        { label: 'Remove Alarm Suppression', id: 'remove_alarm_suppression' },
      ],
      value: () => 'list_metrics',
    },
    {
      id: 'credential',
      title: 'OCI Account',
      type: 'oauth-input',
      serviceId: 'oci_monitoring',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      requiredScopes: getScopesForService('oci_monitoring'),
      mode: 'basic',
      required: true,
      placeholder: 'Select an OCI credential',
    },
    {
      id: 'manualCredential',
      title: 'OCI Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      required: true,
      placeholder: 'Enter credential ID',
    },
    {
      id: 'region',
      title: 'OCI Region',
      type: 'short-input',
      placeholder: 'Credential region, or e.g. us-ashburn-1',
    },
    {
      id: 'compartmentId',
      title: 'Compartment ID',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'list_metrics',
          'summarize_metrics_data',
          'list_alarms',
          'list_alarms_status',
          'create_alarm',
          'update_alarm',
          'get_alarm',
          'get_alarm_history',
          'retrieve_dimension_states',
          'delete_alarm',
          'create_alarm_suppression',
          'list_alarm_suppressions',
          'get_alarm_suppression',
          'delete_alarm_suppression',
          'summarize_alarm_suppression_history',
          'remove_alarm_suppression',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'list_metrics',
          'summarize_metrics_data',
          'list_alarms',
          'list_alarms_status',
          'create_alarm',
        ],
      },
      placeholder:
        'Compartment OCID. Subtree queries require the tenancy OCID and tenancy-level access.',
    },
    {
      id: 'namespaceSelector',
      title: 'Namespace',
      type: 'file-selector',
      canonicalParamId: 'namespace',
      selectorKey: 'oci_monitoring.namespaces',
      dependsOn: {
        all: ['oauthCredential'],
        any: ['oauthCredential', 'region', 'compartmentId', 'metricCompartmentId'],
      },
      mode: 'basic',
      condition: {
        field: 'operation',
        value: ['list_metrics', 'summarize_metrics_data', 'create_alarm', 'update_alarm'],
      },
      required: { field: 'operation', value: ['summarize_metrics_data', 'create_alarm'] },
      placeholder: 'Select namespace',
    },
    {
      id: 'namespaceInput',
      title: 'Namespace',
      type: 'short-input',
      canonicalParamId: 'namespace',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['list_metrics', 'summarize_metrics_data', 'create_alarm', 'update_alarm'],
      },
      required: { field: 'operation', value: ['summarize_metrics_data', 'create_alarm'] },
      placeholder: 'Enter namespace',
    },
    {
      id: 'name',
      title: 'Metric Name',
      type: 'short-input',
      condition: { field: 'operation', value: ['list_metrics'] },
      required: false,
      placeholder: 'Exact metric name to discover.',
    },
    {
      id: 'resourceGroup',
      title: 'Resource Group',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['list_metrics', 'summarize_metrics_data', 'create_alarm', 'update_alarm'],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'Optional metric resource group; leave blank to omit this filter.',
    },
    {
      id: 'dimensionFilters',
      title: 'Dimension Filters',
      type: 'code',
      condition: { field: 'operation', value: ['list_metrics', 'retrieve_dimension_states'] },
      required: false,
      mode: 'advanced',
      placeholder:
        'JSON object of dimension names and values. Discovery ignores this with groupBy; dimension-state retrieval requires an exact complete set of dimensions.',
      wandConfig: {
        enabled: true,
        prompt:
          'JSON object of dimension names and values. Discovery ignores this with groupBy; dimension-state retrieval requires an exact complete set of dimensions. Return ONLY the JSON object.',
        placeholder: 'Describe the desired value',
        generationType: 'json-object',
      },
    },
    {
      id: 'groupBy',
      title: 'Group By',
      type: 'code',
      condition: { field: 'operation', value: ['list_metrics'] },
      required: false,
      mode: 'advanced',
      placeholder:
        'JSON array of namespace, name, or resourceGroup. When present, dimensionFilters is ignored.',
      wandConfig: {
        enabled: true,
        prompt:
          'JSON array of namespace, name, or resourceGroup. When present, dimensionFilters is ignored. Return ONLY the JSON array.',
        placeholder: 'Describe the desired value',
        generationType: 'json-array',
      },
    },
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['list_metrics', 'list_alarms', 'list_alarms_status', 'list_alarm_suppressions'],
      },
      required: false,
      mode: 'advanced',
      placeholder:
        'Metrics: NAMESPACE, NAME, RESOURCEGROUP. Alarms: displayName, severity. Suppressions: displayName, timeCreated, timeSuppressFrom.',
    },
    {
      id: 'sortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['list_metrics', 'list_alarms', 'list_alarms_status', 'list_alarm_suppressions'],
      },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Use default / keep current', id: '' },
        { label: 'ASC', id: 'ASC' },
        { label: 'DESC', id: 'DESC' },
      ],
    },
    {
      id: 'compartmentIdInSubtree',
      title: 'Compartment Id In Subtree',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['list_metrics', 'summarize_metrics_data', 'list_alarms', 'list_alarms_status'],
      },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Use default / keep current', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'list_metrics',
          'list_alarms',
          'list_alarms_status',
          'get_alarm_history',
          'retrieve_dimension_states',
          'list_alarm_suppressions',
          'summarize_alarm_suppression_history',
        ],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'Maximum results on this page: 1–1000; defaults to 100.',
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'list_metrics',
          'list_alarms',
          'list_alarms_status',
          'get_alarm_history',
          'retrieve_dimension_states',
          'list_alarm_suppressions',
          'summarize_alarm_suppression_history',
        ],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'Opaque nextPage from the previous response.',
    },
    {
      id: 'query',
      title: 'MQL Query',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['summarize_metrics_data', 'create_alarm', 'update_alarm'],
      },
      required: { field: 'operation', value: ['summarize_metrics_data', 'create_alarm'] },
      placeholder:
        'Oracle MQL expression, such as CpuUtilization[1m].mean(); alarm expressions also require a threshold or absence condition.',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an Oracle Monitoring MQL expression. Example: CpuUtilization[1m].mean(); alarms require a threshold such as > 90 or absent(). Preserve dimension values in quoted filters. Return ONLY the MQL expression.',
        placeholder: 'Describe the desired value',
      },
    },
    {
      id: 'startTime',
      title: 'Start Time',
      type: 'short-input',
      condition: { field: 'operation', value: ['summarize_metrics_data'] },
      required: false,
      mode: 'advanced',
      placeholder:
        'Inclusive RFC3339 query start. Oracle defaults to three hours before the request.',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a timestamp in RFC3339 format with a timezone, such as 2026-01-01T12:00:00Z. Return ONLY the timestamp.',
        placeholder: 'Describe the desired value',
        generationType: 'timestamp',
      },
    },
    {
      id: 'endTime',
      title: 'End Time',
      type: 'short-input',
      condition: { field: 'operation', value: ['summarize_metrics_data'] },
      required: false,
      mode: 'advanced',
      placeholder: 'Exclusive RFC3339 query end. Oracle defaults to request time.',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a timestamp in RFC3339 format with a timezone, such as 2026-01-01T12:00:00Z. Return ONLY the timestamp.',
        placeholder: 'Describe the desired value',
        generationType: 'timestamp',
      },
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['summarize_metrics_data', 'create_alarm', 'update_alarm'],
      },
      required: false,
      mode: 'advanced',
      placeholder:
        'Aggregation window spacing, no greater than the MQL interval. Queries accept 1m–60m, 1h–24h, or 1d; alarms accept only 1m.',
    },
    {
      id: 'maxStreams',
      title: 'Maximum Streams',
      type: 'short-input',
      condition: { field: 'operation', value: ['summarize_metrics_data'] },
      required: false,
      mode: 'advanced',
      placeholder:
        'Maximum returned metric streams: defaults to 100, up to 2000. Excess results fail without truncation.',
    },
    {
      id: 'maxDatapoints',
      title: 'Maximum Datapoints',
      type: 'short-input',
      condition: { field: 'operation', value: ['summarize_metrics_data'] },
      required: false,
      mode: 'advanced',
      placeholder:
        'Maximum total returned datapoints: defaults to 10000, up to 100000. Excess results fail without truncation.',
    },
    {
      id: 'metricData',
      title: 'Metric Data',
      type: 'code',
      condition: { field: 'operation', value: ['post_metric_data'] },
      required: { field: 'operation', value: ['post_metric_data'] },
      placeholder:
        'JSON array of custom metric records (compartmentId, namespace, name, dimensions, datapoints). Sim allows 50 records and 1 MiB per request. Timestamps must be less than two hours old and less than ten minutes ahead.',
      wandConfig: {
        enabled: true,
        prompt:
          'JSON array of custom metric records (compartmentId, namespace, name, dimensions, datapoints). Sim allows 50 records and 1 MiB per request. Timestamps must be less than two hours old and less than ten minutes ahead. Return ONLY the JSON array.',
        placeholder: 'Describe the desired value',
        generationType: 'json-array',
      },
    },
    {
      id: 'batchAtomicity',
      title: 'Batch Atomicity',
      type: 'dropdown',
      condition: { field: 'operation', value: ['post_metric_data'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Use default / keep current', id: '' },
        { label: 'ATOMIC', id: 'ATOMIC' },
        { label: 'NON_ATOMIC', id: 'NON_ATOMIC' },
      ],
    },
    {
      id: 'displayName',
      title: 'Display Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'list_alarms',
          'list_alarms_status',
          'create_alarm',
          'update_alarm',
          'create_alarm_suppression',
          'list_alarm_suppressions',
        ],
      },
      required: { field: 'operation', value: ['create_alarm', 'create_alarm_suppression'] },
      placeholder: 'Alarm or suppression display name; list operations use exact matching.',
    },
    {
      id: 'lifecycleState',
      title: 'Lifecycle State',
      type: 'short-input',
      condition: { field: 'operation', value: ['list_alarms', 'list_alarm_suppressions'] },
      required: false,
      mode: 'advanced',
      placeholder: 'ACTIVE or DELETED; alarms also accept DELETING. Omit for ACTIVE.',
    },
    {
      id: 'resourceId',
      title: 'Resource Id',
      type: 'short-input',
      condition: { field: 'operation', value: ['list_alarms_status'] },
      required: false,
      mode: 'advanced',
      placeholder: 'Filter alarm status by monitored resource OCID.',
    },
    {
      id: 'serviceName',
      title: 'Service Name',
      type: 'short-input',
      condition: { field: 'operation', value: ['list_alarms_status'] },
      required: false,
      mode: 'advanced',
      placeholder: 'Filter by the exact service-name dimension.',
    },
    {
      id: 'entityId',
      title: 'Entity Id',
      type: 'short-input',
      condition: { field: 'operation', value: ['list_alarms_status'] },
      required: false,
      mode: 'advanced',
      placeholder: 'Filter by monitored entity OCID.',
    },
    {
      id: 'status',
      title: 'Status',
      type: 'dropdown',
      condition: { field: 'operation', value: ['list_alarms_status', 'retrieve_dimension_states'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Use default / keep current', id: '' },
        { label: 'FIRING', id: 'FIRING' },
        { label: 'OK', id: 'OK' },
      ],
    },
    {
      id: 'alarmIdSelector',
      title: 'Alarm',
      type: 'file-selector',
      canonicalParamId: 'alarmId',
      selectorKey: 'oci_monitoring.alarms',
      dependsOn: {
        all: ['oauthCredential', 'compartmentId'],
        any: ['oauthCredential', 'region'],
      },
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'get_alarm',
          'get_alarm_history',
          'retrieve_dimension_states',
          'update_alarm',
          'delete_alarm',
          'create_alarm_suppression',
          'list_alarm_suppressions',
          'summarize_alarm_suppression_history',
          'remove_alarm_suppression',
          'get_alarm_suppression',
          'delete_alarm_suppression',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_alarm',
          'get_alarm_history',
          'retrieve_dimension_states',
          'update_alarm',
          'delete_alarm',
          'create_alarm_suppression',
          'list_alarm_suppressions',
          'summarize_alarm_suppression_history',
          'remove_alarm_suppression',
        ],
      },
      placeholder: 'Select alarm',
    },
    {
      id: 'alarmIdInput',
      title: 'Alarm',
      type: 'short-input',
      canonicalParamId: 'alarmId',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'get_alarm',
          'get_alarm_history',
          'retrieve_dimension_states',
          'update_alarm',
          'delete_alarm',
          'create_alarm_suppression',
          'list_alarm_suppressions',
          'summarize_alarm_suppression_history',
          'remove_alarm_suppression',
          'get_alarm_suppression',
          'delete_alarm_suppression',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_alarm',
          'get_alarm_history',
          'retrieve_dimension_states',
          'update_alarm',
          'delete_alarm',
          'create_alarm_suppression',
          'list_alarm_suppressions',
          'summarize_alarm_suppression_history',
          'remove_alarm_suppression',
        ],
      },
      placeholder: 'Enter alarm',
    },
    {
      id: 'alarmHistorytype',
      title: 'History Type',
      type: 'dropdown',
      condition: { field: 'operation', value: ['get_alarm_history'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Use default / keep current', id: '' },
        { label: 'STATE_HISTORY', id: 'STATE_HISTORY' },
        { label: 'STATE_TRANSITION_HISTORY', id: 'STATE_TRANSITION_HISTORY' },
        { label: 'RULE_HISTORY', id: 'RULE_HISTORY' },
        { label: 'RULE_TRANSITION_HISTORY', id: 'RULE_TRANSITION_HISTORY' },
      ],
    },
    {
      id: 'timestampGreaterThanOrEqualTo',
      title: 'Timestamp Greater Than Or Equal To',
      type: 'short-input',
      condition: { field: 'operation', value: ['get_alarm_history'] },
      required: false,
      mode: 'advanced',
      placeholder: 'Inclusive RFC3339 lower bound for alarm history.',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a timestamp in RFC3339 format with a timezone, such as 2026-01-01T12:00:00Z. Return ONLY the timestamp.',
        placeholder: 'Describe the desired value',
        generationType: 'timestamp',
      },
    },
    {
      id: 'timestampLessThan',
      title: 'Timestamp Less Than',
      type: 'short-input',
      condition: { field: 'operation', value: ['get_alarm_history'] },
      required: false,
      mode: 'advanced',
      placeholder: 'Exclusive RFC3339 upper bound for alarm history.',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a timestamp in RFC3339 format with a timezone, such as 2026-01-01T12:00:00Z. Return ONLY the timestamp.',
        placeholder: 'Describe the desired value',
        generationType: 'timestamp',
      },
    },
    {
      id: 'metricCompartmentId',
      title: 'Metric Compartment ID',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_alarm', 'update_alarm'] },
      required: { field: 'operation', value: ['create_alarm'] },
      placeholder: 'Compartment OCID containing the metrics evaluated by the alarm.',
    },
    {
      id: 'severity',
      title: 'Severity',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_alarm', 'update_alarm'] },
      required: { field: 'operation', value: ['create_alarm'] },
      options: [
        { label: 'CRITICAL', id: 'CRITICAL' },
        { label: 'ERROR', id: 'ERROR' },
        { label: 'WARNING', id: 'WARNING' },
        { label: 'INFO', id: 'INFO' },
      ],
    },
    {
      id: 'destinations',
      title: 'Destinations',
      type: 'code',
      condition: { field: 'operation', value: ['create_alarm', 'update_alarm'] },
      required: { field: 'operation', value: ['create_alarm'] },
      placeholder:
        'JSON array of existing Notifications topic or Streaming stream OCIDs; at most one per destination service.',
      wandConfig: {
        enabled: true,
        prompt:
          'JSON array of existing Notifications topic or Streaming stream OCIDs; at most one per destination service. Return ONLY the JSON array.',
        placeholder: 'Describe the desired value',
        generationType: 'json-array',
      },
    },
    {
      id: 'isEnabled',
      title: 'Alarm Enabled',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_alarm', 'update_alarm'] },
      required: { field: 'operation', value: ['create_alarm'] },
      options: [
        { label: 'Use default / keep current', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
    },
    {
      id: 'metricCompartmentIdInSubtree',
      title: 'Metric Compartment Id In Subtree',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_alarm', 'update_alarm'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Use default / keep current', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
    },
    {
      id: 'pendingDuration',
      title: 'Pending Duration',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_alarm', 'update_alarm'] },
      required: false,
      mode: 'advanced',
      placeholder: 'ISO 8601 duration before firing, from PT1M to PT1H.',
    },
    {
      id: 'body',
      title: 'Body',
      type: 'long-input',
      condition: { field: 'operation', value: ['create_alarm', 'update_alarm'] },
      required: false,
      mode: 'advanced',
      placeholder: 'Alarm notification message body.',
    },
    {
      id: 'isNotificationsPerMetricDimensionEnabled',
      title: 'Is Notifications Per Metric Dimension Enabled',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_alarm', 'update_alarm'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Use default / keep current', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
    },
    {
      id: 'messageFormat',
      title: 'Message Format',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_alarm', 'update_alarm'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Use default / keep current', id: '' },
        { label: 'RAW', id: 'RAW' },
        { label: 'PRETTY_JSON', id: 'PRETTY_JSON' },
        { label: 'ONS_OPTIMIZED', id: 'ONS_OPTIMIZED' },
      ],
    },
    {
      id: 'repeatNotificationDuration',
      title: 'Repeat Notification Duration',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_alarm', 'update_alarm'] },
      required: false,
      mode: 'advanced',
      placeholder: 'ISO 8601 interval for repeating notifications.',
    },
    {
      id: 'suppression',
      title: 'Suppression',
      type: 'code',
      condition: { field: 'operation', value: ['create_alarm', 'update_alarm'] },
      required: false,
      mode: 'advanced',
      placeholder:
        'JSON object with timeSuppressFrom, timeSuppressUntil, and optional description. Use Remove Alarm Suppression to clear it.',
      wandConfig: {
        enabled: true,
        prompt:
          'JSON object with timeSuppressFrom, timeSuppressUntil, and optional description. Use Remove Alarm Suppression to clear it. Return ONLY the JSON object.',
        placeholder: 'Describe the desired value',
        generationType: 'json-object',
      },
    },
    {
      id: 'freeformTags',
      title: 'Freeform Tags',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['create_alarm', 'update_alarm', 'create_alarm_suppression'],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'JSON object of string tag names and values.',
      wandConfig: {
        enabled: true,
        prompt: 'JSON object of string tag names and values. Return ONLY the JSON object.',
        placeholder: 'Describe the desired value',
        generationType: 'json-object',
      },
    },
    {
      id: 'definedTags',
      title: 'Defined Tags',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['create_alarm', 'update_alarm', 'create_alarm_suppression'],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'JSON object of tag namespaces and values.',
      wandConfig: {
        enabled: true,
        prompt: 'JSON object of tag namespaces and values. Return ONLY the JSON object.',
        placeholder: 'Describe the desired value',
        generationType: 'json-object',
      },
    },
    {
      id: 'overrides',
      title: 'Overrides',
      type: 'code',
      condition: { field: 'operation', value: ['create_alarm', 'update_alarm'] },
      required: false,
      mode: 'advanced',
      placeholder: 'JSON array of up to two alarm trigger-rule overrides.',
      wandConfig: {
        enabled: true,
        prompt: 'JSON array of up to two alarm trigger-rule overrides. Return ONLY the JSON array.',
        placeholder: 'Describe the desired value',
        generationType: 'json-array',
      },
    },
    {
      id: 'ruleName',
      title: 'Rule Name',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_alarm', 'update_alarm'] },
      required: false,
      mode: 'advanced',
      placeholder: 'Name of the base alarm rule.',
    },
    {
      id: 'notificationVersion',
      title: 'Notification Version',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_alarm', 'update_alarm'] },
      required: false,
      mode: 'advanced',
      placeholder: 'Oracle alarm notification version.',
    },
    {
      id: 'notificationTitle',
      title: 'Notification Title',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_alarm', 'update_alarm'] },
      required: false,
      mode: 'advanced',
      placeholder: 'Custom title for alarm notifications.',
    },
    {
      id: 'evaluationSlackDuration',
      title: 'Evaluation Slack Duration',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_alarm', 'update_alarm'] },
      required: false,
      mode: 'advanced',
      placeholder: 'ISO 8601 ingestion delay before evaluation, from PT3M to PT2H.',
    },
    {
      id: 'alarmSummary',
      title: 'Alarm Summary',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_alarm', 'update_alarm'] },
      required: false,
      mode: 'advanced',
      placeholder: 'Custom alarm summary.',
    },
    {
      id: 'opcRetryToken',
      title: 'Retry Token',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_alarm', 'create_alarm_suppression'] },
      required: false,
      mode: 'advanced',
      placeholder:
        'Stable retry token for creation. Enables bounded tokenized retries; reuse it for the same logical creation.',
    },
    {
      id: 'ifMatch',
      title: 'If-Match ETag',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'update_alarm',
          'delete_alarm',
          'delete_alarm_suppression',
          'remove_alarm_suppression',
        ],
      },
      required: false,
      mode: 'advanced',
      placeholder:
        'ETag returned by a previous read; the mutation succeeds only if it still matches.',
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      condition: { field: 'operation', value: ['create_alarm_suppression'] },
      required: false,
      mode: 'advanced',
      placeholder: 'Reason for the suppression.',
    },
    {
      id: 'level',
      title: 'Level',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['create_alarm_suppression', 'list_alarm_suppressions'],
      },
      required: false,
      options: [
        { label: 'ALARM on create / any level on list', id: '' },
        { label: 'ALARM', id: 'ALARM' },
        { label: 'DIMENSION', id: 'DIMENSION' },
      ],
    },
    {
      id: 'dimensions',
      title: 'Dimensions',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['create_alarm_suppression', 'summarize_alarm_suppression_history'],
      },
      required: {
        field: 'operation',
        value: 'create_alarm_suppression',
        and: { field: 'level', value: 'DIMENSION' },
      },
      placeholder:
        'JSON object of dimension names and single string values; required for dimension suppression.',
      wandConfig: {
        enabled: true,
        prompt:
          'JSON object of dimension names and single string values; required for dimension suppression. Return ONLY the JSON object.',
        placeholder: 'Describe the desired value',
        generationType: 'json-object',
      },
    },
    {
      id: 'timeSuppressFrom',
      title: 'Time Suppress From',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_alarm_suppression'] },
      required: { field: 'operation', value: ['create_alarm_suppression'] },
      placeholder: 'Inclusive RFC3339 start of suppression.',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a timestamp in RFC3339 format with a timezone, such as 2026-01-01T12:00:00Z. Return ONLY the timestamp.',
        placeholder: 'Describe the desired value',
        generationType: 'timestamp',
      },
    },
    {
      id: 'timeSuppressUntil',
      title: 'Time Suppress Until',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_alarm_suppression'] },
      required: { field: 'operation', value: ['create_alarm_suppression'] },
      placeholder: 'Inclusive RFC3339 end of suppression.',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a timestamp in RFC3339 format with a timezone, such as 2026-01-01T12:00:00Z. Return ONLY the timestamp.',
        placeholder: 'Describe the desired value',
        generationType: 'timestamp',
      },
    },
    {
      id: 'isAllSuppressions',
      title: 'Is All Suppressions',
      type: 'dropdown',
      condition: { field: 'operation', value: ['list_alarm_suppressions'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Use default / keep current', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
    },
    {
      id: 'alarmSuppressionIdSelector',
      title: 'Alarm Suppression',
      type: 'file-selector',
      canonicalParamId: 'alarmSuppressionId',
      selectorKey: 'oci_monitoring.alarmSuppressions',
      dependsOn: {
        all: ['oauthCredential', 'alarmId'],
        any: ['oauthCredential', 'region'],
      },
      mode: 'basic',
      condition: {
        field: 'operation',
        value: ['get_alarm_suppression', 'delete_alarm_suppression'],
      },
      required: {
        field: 'operation',
        value: ['get_alarm_suppression', 'delete_alarm_suppression'],
      },
      placeholder: 'Select alarm suppression',
    },
    {
      id: 'alarmSuppressionIdInput',
      title: 'Alarm Suppression',
      type: 'short-input',
      canonicalParamId: 'alarmSuppressionId',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['get_alarm_suppression', 'delete_alarm_suppression'],
      },
      required: {
        field: 'operation',
        value: ['get_alarm_suppression', 'delete_alarm_suppression'],
      },
      placeholder: 'Enter alarm suppression',
    },
    {
      id: 'timeSuppressFromGreaterThanOrEqualTo',
      title: 'Time Suppress From Greater Than Or Equal To',
      type: 'short-input',
      condition: { field: 'operation', value: ['summarize_alarm_suppression_history'] },
      required: false,
      mode: 'advanced',
      placeholder:
        'Inclusive RFC3339 lower bound on suppression start time; cannot be in the future.',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a timestamp in RFC3339 format with a timezone, such as 2026-01-01T12:00:00Z. Return ONLY the timestamp.',
        placeholder: 'Describe the desired value',
        generationType: 'timestamp',
      },
    },
    {
      id: 'timeSuppressFromLessThan',
      title: 'Time Suppress From Less Than',
      type: 'short-input',
      condition: { field: 'operation', value: ['summarize_alarm_suppression_history'] },
      required: false,
      mode: 'advanced',
      placeholder:
        'Exclusive RFC3339 upper bound on suppression start time; cannot be in the future.',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a timestamp in RFC3339 format with a timezone, such as 2026-01-01T12:00:00Z. Return ONLY the timestamp.',
        placeholder: 'Describe the desired value',
        generationType: 'timestamp',
      },
    },
  ],
  tools: {
    access: [
      'oci_monitoring_list_metrics',
      'oci_monitoring_summarize_metrics_data',
      'oci_monitoring_post_metric_data',
      'oci_monitoring_list_alarms',
      'oci_monitoring_list_alarms_status',
      'oci_monitoring_get_alarm',
      'oci_monitoring_get_alarm_history',
      'oci_monitoring_retrieve_dimension_states',
      'oci_monitoring_create_alarm',
      'oci_monitoring_update_alarm',
      'oci_monitoring_delete_alarm',
      'oci_monitoring_create_alarm_suppression',
      'oci_monitoring_list_alarm_suppressions',
      'oci_monitoring_get_alarm_suppression',
      'oci_monitoring_delete_alarm_suppression',
      'oci_monitoring_summarize_alarm_suppression_history',
      'oci_monitoring_remove_alarm_suppression',
    ],
    config: {
      tool: (params) => `oci_monitoring_${params.operation}`,
      params: (params) => {
        const { operation, ...result } = params
        for (const key of ['limit', 'maxStreams', 'maxDatapoints']) {
          if (typeof result[key] === 'string' && result[key].trim() !== '') {
            result[key] = Number(result[key])
          }
        }
        for (const key of [
          'compartmentIdInSubtree',
          'metricCompartmentIdInSubtree',
          'isEnabled',
          'isNotificationsPerMetricDimensionEnabled',
          'isAllSuppressions',
        ]) {
          if (result[key] === 'true') result[key] = true
          else if (result[key] === 'false') result[key] = false
        }
        return Object.fromEntries(
          Object.entries(result).map(([key, value]) => [
            key,
            value === '' || value === null ? undefined : value,
          ])
        )
      },
    },
  },
  inputs: {
    oauthCredential: { type: 'string', description: 'Reusable OCI credential ID' },
    region: { type: 'string', description: 'Optional OCI region override' },
    compartmentId: {
      type: 'string',
      description:
        'Compartment OCID. Subtree queries require the tenancy OCID and tenancy-level access.',
    },
    namespace: { type: 'string', description: 'Metric namespace, such as oci_computeagent.' },
    name: { type: 'string', description: 'Exact metric name to discover.' },
    resourceGroup: {
      type: 'string',
      description: 'Optional metric resource group; leave blank to omit this filter.',
    },
    dimensionFilters: {
      type: 'json',
      description:
        'JSON object of dimension names and values. Discovery ignores this with groupBy; dimension-state retrieval requires an exact complete set of dimensions.',
    },
    groupBy: {
      type: 'json',
      description:
        'JSON array of namespace, name, or resourceGroup. When present, dimensionFilters is ignored.',
    },
    sortBy: {
      type: 'string',
      description:
        'Metrics: NAMESPACE, NAME, RESOURCEGROUP. Alarms: displayName, severity. Suppressions: displayName, timeCreated, timeSuppressFrom.',
    },
    sortOrder: { type: 'string', description: 'Sort direction: ASC or DESC.' },
    compartmentIdInSubtree: {
      type: 'boolean',
      description:
        'Include child compartments; requires the tenancy OCID and tenancy-level permissions.',
    },
    limit: {
      type: 'number',
      description: 'Maximum results on this page: 1–1000; defaults to 100.',
    },
    page: { type: 'string', description: 'Opaque nextPage from the previous response.' },
    query: {
      type: 'string',
      description:
        'Oracle MQL expression, such as CpuUtilization[1m].mean(); alarm expressions also require a threshold or absence condition.',
    },
    startTime: {
      type: 'string',
      description:
        'Inclusive RFC3339 query start. Oracle defaults to three hours before the request.',
    },
    endTime: {
      type: 'string',
      description: 'Exclusive RFC3339 query end. Oracle defaults to request time.',
    },
    resolution: {
      type: 'string',
      description:
        'Aggregation window spacing, no greater than the MQL interval. Queries accept 1m–60m, 1h–24h, or 1d; alarms accept only 1m.',
    },
    maxStreams: {
      type: 'number',
      description:
        'Maximum returned metric streams: defaults to 100, up to 2000. Excess results fail without truncation.',
    },
    maxDatapoints: {
      type: 'number',
      description:
        'Maximum total returned datapoints: defaults to 10000, up to 100000. Excess results fail without truncation.',
    },
    metricData: {
      type: 'json',
      description:
        'JSON array of custom metric records (compartmentId, namespace, name, dimensions, datapoints). Sim allows 50 records and 1 MiB per request. Timestamps must be less than two hours old and less than ten minutes ahead.',
    },
    batchAtomicity: {
      type: 'string',
      description:
        'ATOMIC rejects the whole batch on validation failure; NON_ATOMIC permits partial acceptance.',
    },
    displayName: {
      type: 'string',
      description: 'Alarm or suppression display name; list operations use exact matching.',
    },
    lifecycleState: {
      type: 'string',
      description: 'ACTIVE or DELETED; alarms also accept DELETING. Omit for ACTIVE.',
    },
    resourceId: { type: 'string', description: 'Filter alarm status by monitored resource OCID.' },
    serviceName: { type: 'string', description: 'Filter by the exact service-name dimension.' },
    entityId: { type: 'string', description: 'Filter by monitored entity OCID.' },
    status: { type: 'string', description: 'Alarm status: FIRING or OK.' },
    alarmId: { type: 'string', description: 'Alarm OCID.' },
    alarmHistorytype: {
      type: 'string',
      description:
        'STATE_HISTORY, STATE_TRANSITION_HISTORY, RULE_HISTORY, or RULE_TRANSITION_HISTORY.',
    },
    timestampGreaterThanOrEqualTo: {
      type: 'string',
      description: 'Inclusive RFC3339 lower bound for alarm history.',
    },
    timestampLessThan: {
      type: 'string',
      description: 'Exclusive RFC3339 upper bound for alarm history.',
    },
    metricCompartmentId: {
      type: 'string',
      description: 'Compartment OCID containing the metrics evaluated by the alarm.',
    },
    severity: { type: 'string', description: 'Alarm severity: CRITICAL, ERROR, WARNING, or INFO.' },
    destinations: {
      type: 'json',
      description:
        'JSON array of existing Notifications topic or Streaming stream OCIDs; at most one per destination service.',
    },
    isEnabled: {
      type: 'boolean',
      description:
        'Whether the alarm evaluates its MQL condition. Omit on update to preserve the existing value.',
    },
    metricCompartmentIdInSubtree: {
      type: 'boolean',
      description: 'Evaluate metrics in child compartments; requires tenancy-level metric access.',
    },
    pendingDuration: {
      type: 'string',
      description: 'ISO 8601 duration before firing, from PT1M to PT1H.',
    },
    body: { type: 'string', description: 'Alarm notification message body.' },
    isNotificationsPerMetricDimensionEnabled: {
      type: 'boolean',
      description:
        'Send separate notifications per metric stream; required by Oracle for dimension-specific suppression.',
    },
    messageFormat: {
      type: 'string',
      description: 'Notification format: RAW, PRETTY_JSON, or ONS_OPTIMIZED.',
    },
    repeatNotificationDuration: {
      type: 'string',
      description: 'ISO 8601 interval for repeating notifications.',
    },
    suppression: {
      type: 'json',
      description:
        'JSON object with timeSuppressFrom, timeSuppressUntil, and optional description. Use Remove Alarm Suppression to clear it.',
    },
    freeformTags: { type: 'json', description: 'JSON object of string tag names and values.' },
    definedTags: { type: 'json', description: 'JSON object of tag namespaces and values.' },
    overrides: {
      type: 'json',
      description: 'JSON array of up to two alarm trigger-rule overrides.',
    },
    ruleName: { type: 'string', description: 'Name of the base alarm rule.' },
    notificationVersion: { type: 'string', description: 'Oracle alarm notification version.' },
    notificationTitle: { type: 'string', description: 'Custom title for alarm notifications.' },
    evaluationSlackDuration: {
      type: 'string',
      description: 'ISO 8601 ingestion delay before evaluation, from PT3M to PT2H.',
    },
    alarmSummary: { type: 'string', description: 'Custom alarm summary.' },
    opcRetryToken: {
      type: 'string',
      description:
        'Stable retry token for creation. Enables bounded tokenized retries; reuse it for the same logical creation.',
    },
    ifMatch: {
      type: 'string',
      description:
        'ETag returned by a previous read; the mutation succeeds only if it still matches.',
    },
    description: { type: 'string', description: 'Reason for the suppression.' },
    level: {
      type: 'string',
      description:
        'ALARM for the whole alarm or DIMENSION for specific metric streams. Sim defaults new suppressions to ALARM.',
    },
    dimensions: {
      type: 'json',
      description:
        'JSON object of dimension names and single string values; required for dimension suppression.',
    },
    timeSuppressFrom: { type: 'string', description: 'Inclusive RFC3339 start of suppression.' },
    timeSuppressUntil: { type: 'string', description: 'Inclusive RFC3339 end of suppression.' },
    isAllSuppressions: {
      type: 'boolean',
      description: 'Include compartment or tenancy suppressions affecting the selected alarm.',
    },
    alarmSuppressionId: { type: 'string', description: 'Alarm suppression OCID.' },
    timeSuppressFromGreaterThanOrEqualTo: {
      type: 'string',
      description:
        'Inclusive RFC3339 lower bound on suppression start time; cannot be in the future.',
    },
    timeSuppressFromLessThan: {
      type: 'string',
      description:
        'Exclusive RFC3339 upper bound on suppression start time; cannot be in the future.',
    },
  },
  outputs: {
    opcRequestId: { type: 'string', description: 'Oracle request ID' },
    metrics: {
      type: 'json',
      description:
        'Discovered metric definitions; grouping can omit non-grouped fields (name, namespace, resourceGroup, compartmentId, dimensions)',
    },
    nextPage: { type: 'string', description: 'Opaque token for the next page; null when complete' },
    metricData: {
      type: 'json',
      description:
        'Aggregated metric time series (name, namespace, resourceGroup, compartmentId, dimensions, metadata, resolution, aggregatedDatapoints)',
    },
    alarms: {
      type: 'json',
      description:
        'Alarm summaries (id, displayName, compartmentId, metricCompartmentId, namespace, resourceGroup, query, severity, isEnabled, lifecycleState, destinations, suppression, ruleName, notificationVersion, notificationTitle, evaluationSlackDuration, alarmSummary, isNotificationsPerMetricDimensionEnabled, freeformTags, definedTags, overrides)',
    },
    alarm: {
      type: 'json',
      description:
        'Alarm configuration (id, displayName, compartmentId, metricCompartmentId, namespace, query, severity, destinations, isEnabled, suppression, overrides, lifecycleState, timeCreated, timeUpdated)',
    },
    etag: { type: 'string', description: 'Concurrency ETag' },
    alarmStatuses: {
      type: 'json',
      description:
        'Aggregate alarm statuses (id, displayName, severity, ruleName, timestampTriggered, alarmSummary, status, suppression)',
    },
    alarmId: { type: 'string', description: 'Alarm OCID' },
    isEnabled: { type: 'boolean', description: 'Whether the alarm is enabled' },
    history: {
      type: 'json',
      description: 'Alarm history entries (alarmSummary, summary, timestamp, timestampTriggered)',
    },
    isNotificationsPerMetricDimensionEnabled: {
      type: 'boolean',
      description: 'Whether notifications are split',
    },
    dimensionStates: {
      type: 'json',
      description:
        'Individual metric stream states (alarmSummary, dimensions, status, ruleName, timestamp)',
    },
    alarmSuppression: {
      type: 'json',
      description:
        'Suppression configuration (id, compartmentId, alarmSuppressionTarget, level, displayName, dimensions, timeSuppressFrom, timeSuppressUntil, lifecycleState, suppressionConditions)',
    },
    alarmSuppressions: {
      type: 'json',
      description:
        'Suppression resources (id, compartmentId, alarmSuppressionTarget, level, displayName, description, dimensions, timeSuppressFrom, timeSuppressUntil, lifecycleState, timeCreated, timeUpdated, suppressionConditions, freeformTags, definedTags)',
    },
    suppressionHistory: {
      type: 'json',
      description:
        'Effective suppression history (suppressionId, alarmSuppressionTarget, level, displayName, description, dimensions, timeEffectiveFrom, timeEffectiveUntil, suppressionConditions)',
    },
    failedMetricsCount: { type: 'number', description: 'Number of rejected metric records' },
    failedMetrics: {
      type: 'json',
      description: 'Rejected metric records and their validation errors (message, metricData)',
    },
  },
}

export const OciMonitoringBlockMeta = {
  tags: ['monitoring', 'cloud', 'incident-management'],
  url: 'https://www.oracle.com/cloud/observability-and-management/monitoring/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Explore available metrics',
      prompt:
        'Create a workflow that lists OCI metric namespaces and definitions in a chosen compartment, then summarizes the available dimensions before selecting an MQL query.',
      modules: ['workflows', 'agent'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Report infrastructure trends',
      prompt:
        'Create a scheduled workflow that queries selected OCI CPU and memory metrics over a bounded time window and writes a trend summary to a table.',
      modules: ['workflows', 'scheduled', 'tables', 'agent'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Publish application metrics',
      prompt:
        'Create a workflow that publishes a bounded batch of custom OCI application metrics, inspects failed records, and queries the accepted metrics after ingestion.',
      modules: ['workflows', 'agent'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Triage firing alarms',
      prompt:
        'Create a scheduled workflow that lists firing OCI alarms, gets their definitions, and reads recent history to prioritize investigation.',
      modules: ['workflows', 'scheduled', 'agent'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Create a threshold alarm',
      prompt:
        'Create an OCI alarm from a chosen metric and threshold, using an existing notification destination, then retrieve the alarm configuration.',
      modules: ['workflows', 'agent'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Suppress maintenance alerts',
      prompt:
        'Create a workflow that schedules a suppression for a chosen OCI alarm during a maintenance window and confirms its scope and timestamps.',
      modules: ['workflows', 'agent'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Audit dimension suppressions',
      prompt:
        'Create a workflow that inspects OCI alarm dimension states and suppression history for a selected resource to explain its notification gaps.',
      modules: ['workflows', 'agent'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
    },
  ],
  skills: [
    {
      name: 'discover-metrics',
      description: 'Discover metric namespaces and dimensions',
      content:
        '# Discover metric namespaces and dimensions\n\n## Steps\n1. Select an OCI credential, region, and compartment.\n2. List metric definitions with namespace grouping.\n3. Inspect a namespace without grouping to see metric dimensions.\n\n## Output\nA bounded inventory of available metrics and dimensions.',
    },
    {
      name: 'analyze-metric-trends',
      description: 'Analyze a bounded MQL time series',
      content:
        '# Analyze a bounded MQL time series\n\n## Steps\n1. Choose a namespace, metric, and time window.\n2. Write an MQL aggregation and select its resolution.\n3. Query metrics within explicit output budgets and summarize their trend.\n\n## Output\nA trend summary retaining metric dimensions and timestamps.',
    },
    {
      name: 'triage-firing-alarms',
      description: 'Investigate firing alarms and recent transitions',
      content:
        '# Investigate firing alarms and recent transitions\n\n## Steps\n1. List alarm statuses filtered to FIRING.\n2. Get the alarm definition and recent history.\n3. Inspect dimension states to identify affected metric streams.\n\n## Output\nA prioritized list of affected streams and alarm transitions.',
    },
    {
      name: 'suppress-maintenance-dimensions',
      description: 'Suppress selected metric streams during maintenance',
      content:
        '# Suppress selected metric streams during maintenance\n\n## Steps\n1. Select an alarm and verify that split notifications are enabled.\n2. Confirm the resource dimensions and maintenance window.\n3. Create a DIMENSION suppression and retrieve it to verify the scope.\n\n## Output\nThe suppression ID, target dimensions, and inclusive start and end times.',
    },
    {
      name: 'audit-suppression-history',
      description: 'Explain suppression periods for an alarm',
      content:
        '# Explain suppression periods for an alarm\n\n## Steps\n1. Select the alarm and an investigation window.\n2. Get suppression history using the documented time filters.\n3. Compare the effective suppression periods with alarm history.\n\n## Output\nA timeline of suppression periods and affected dimensions.',
    },
  ],
} as const satisfies BlockMeta
