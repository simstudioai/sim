import {
  OCI_ALARM_OUTPUTS,
  type OciMonitoringCreateAlarmParams,
  type OciMonitoringResponse,
} from '@/tools/oci_monitoring/types'
import { OCI_CONNECTION_PARAMS, transformOciMonitoringResponse } from '@/tools/oci_monitoring/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociMonitoringCreateAlarmTool: InternalToolConfig<
  OciMonitoringCreateAlarmParams,
  OciMonitoringResponse
> = {
  id: 'oci_monitoring_create_alarm',
  name: 'OCI Monitoring Create Alarm',
  description: 'Create a metric alarm using existing notification destinations',
  version: '1.0.0',
  params: {
    ...OCI_CONNECTION_PARAMS,
    displayName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Alarm or suppression display name; list operations use exact matching.',
    },
    compartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Compartment OCID. Subtree queries require the tenancy OCID and tenancy-level access.',
    },
    metricCompartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Compartment OCID containing the metrics evaluated by the alarm.',
    },
    namespace: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Metric namespace, such as oci_computeagent.',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Oracle MQL expression, such as CpuUtilization[1m].mean(); alarm expressions also require a threshold or absence condition.',
    },
    severity: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Alarm severity: CRITICAL, ERROR, WARNING, or INFO.',
    },
    destinations: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of existing Notifications topic or Streaming stream OCIDs; at most one per destination service.',
    },
    isEnabled: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Whether the alarm evaluates its MQL condition. Omit on update to preserve the existing value.',
    },
    metricCompartmentIdInSubtree: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Evaluate metrics in child compartments; requires tenancy-level metric access.',
    },
    resourceGroup: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Metric resource group; null matches metrics without a resource group.',
    },
    resolution: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Aggregation window spacing, no greater than the MQL interval. Queries accept 1m–60m, 1h–24h, or 1d; alarms accept only 1m.',
    },
    pendingDuration: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 8601 duration before firing, from PT1M to PT1H.',
    },
    body: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Alarm notification message body.',
    },
    isNotificationsPerMetricDimensionEnabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Send separate notifications per metric stream; required by Oracle for dimension-specific suppression.',
    },
    messageFormat: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Notification format: RAW, PRETTY_JSON, or ONS_OPTIMIZED.',
    },
    repeatNotificationDuration: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 8601 interval for repeating notifications.',
    },
    suppression: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object with timeSuppressFrom, timeSuppressUntil, and optional description. Use Remove Alarm Suppression to clear it.',
    },
    freeformTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object of string tag names and values.',
    },
    definedTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object of tag namespaces and values.',
    },
    overrides: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of up to two alarm trigger-rule overrides.',
    },
    ruleName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name of the base alarm rule.',
    },
    notificationVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Oracle alarm notification version.',
    },
    notificationTitle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom title for alarm notifications.',
    },
    evaluationSlackDuration: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 8601 ingestion delay before evaluation, from PT3M to PT2H.',
    },
    alarmSummary: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom alarm summary.',
    },
    opcRetryToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Stable retry token for creation. Enables bounded tokenized retries; reuse it for the same logical creation.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      displayName: params.displayName,
      compartmentId: params.compartmentId,
      metricCompartmentId: params.metricCompartmentId,
      namespace: params.namespace,
      query: params.query,
      severity: params.severity,
      destinations: params.destinations,
      isEnabled: params.isEnabled,
      metricCompartmentIdInSubtree: params.metricCompartmentIdInSubtree,
      resourceGroup: params.resourceGroup,
      resolution: params.resolution,
      pendingDuration: params.pendingDuration,
      body: params.body,
      isNotificationsPerMetricDimensionEnabled: params.isNotificationsPerMetricDimensionEnabled,
      messageFormat: params.messageFormat,
      repeatNotificationDuration: params.repeatNotificationDuration,
      suppression: params.suppression,
      freeformTags: params.freeformTags,
      definedTags: params.definedTags,
      overrides: params.overrides,
      ruleName: params.ruleName,
      notificationVersion: params.notificationVersion,
      notificationTitle: params.notificationTitle,
      evaluationSlackDuration: params.evaluationSlackDuration,
      alarmSummary: params.alarmSummary,
      opcRetryToken: params.opcRetryToken,
    }),
  },
  transformResponse: transformOciMonitoringResponse,
  outputs: OCI_ALARM_OUTPUTS,
}
