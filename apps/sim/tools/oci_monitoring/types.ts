import type { OciMonitoringParams } from '@/lib/internal/oci-monitoring/input'
import type {
  OciAlarm,
  OciAlarmHistoryEntry,
  OciAlarmStatus,
  OciAlarmSummary,
  OciAlarmSuppression,
  OciDimensionState,
  OciFailedMetric,
  OciMetric,
  OciMetricData,
  OciSuppressionHistory,
} from '@/lib/internal/oci-monitoring/operations'
import type { ToolResponse } from '@/tools/types'

export type OciMonitoringListMetricsParams = OciMonitoringParams<'list_metrics'>
export type OciMonitoringSummarizeMetricsDataParams = OciMonitoringParams<'summarize_metrics_data'>
export type OciMonitoringPostMetricDataParams = OciMonitoringParams<'post_metric_data'>
export type OciMonitoringListAlarmsParams = OciMonitoringParams<'list_alarms'>
export type OciMonitoringListAlarmsStatusParams = OciMonitoringParams<'list_alarms_status'>
export type OciMonitoringGetAlarmParams = OciMonitoringParams<'get_alarm'>
export type OciMonitoringGetAlarmHistoryParams = OciMonitoringParams<'get_alarm_history'>
export type OciMonitoringRetrieveDimensionStatesParams =
  OciMonitoringParams<'retrieve_dimension_states'>
export type OciMonitoringCreateAlarmParams = OciMonitoringParams<'create_alarm'>
export type OciMonitoringUpdateAlarmParams = OciMonitoringParams<'update_alarm'>
export type OciMonitoringDeleteAlarmParams = OciMonitoringParams<'delete_alarm'>
export type OciMonitoringCreateAlarmSuppressionParams =
  OciMonitoringParams<'create_alarm_suppression'>
export type OciMonitoringListAlarmSuppressionsParams =
  OciMonitoringParams<'list_alarm_suppressions'>
export type OciMonitoringGetAlarmSuppressionParams = OciMonitoringParams<'get_alarm_suppression'>
export type OciMonitoringDeleteAlarmSuppressionParams =
  OciMonitoringParams<'delete_alarm_suppression'>
export type OciMonitoringSummarizeAlarmSuppressionHistoryParams =
  OciMonitoringParams<'summarize_alarm_suppression_history'>
export type OciMonitoringRemoveAlarmSuppressionParams =
  OciMonitoringParams<'remove_alarm_suppression'>

export interface OciMonitoringResponse extends ToolResponse {
  output: {
    opcRequestId?: string | null
    nextPage?: string | null
    etag?: string | null
    metrics?: OciMetric[]
    metricData?: OciMetricData[]
    alarms?: OciAlarmSummary[]
    alarm?: OciAlarm
    alarmStatuses?: OciAlarmStatus[]
    alarmId?: string
    isEnabled?: boolean
    isNotificationsPerMetricDimensionEnabled?: boolean
    history?: OciAlarmHistoryEntry[]
    dimensionStates?: OciDimensionState[]
    alarmSuppression?: OciAlarmSuppression
    alarmSuppressions?: OciAlarmSuppression[]
    suppressionHistory?: OciSuppressionHistory[]
    failedMetricsCount?: number
    failedMetrics?: OciFailedMetric[]
  }
}

const METRIC_PROPERTIES = {
  name: {
    type: 'string',
    description: 'Metric name',
    optional: true,
  },
  namespace: {
    type: 'string',
    description: 'Metric namespace',
    optional: true,
  },
  resourceGroup: {
    type: 'string',
    description: 'Resource group',
    optional: true,
  },
  compartmentId: {
    type: 'string',
    description: 'Metric compartment OCID',
    optional: true,
  },
  dimensions: {
    type: 'json',
    description: 'Dimension names and string values',
    optional: true,
  },
} as const

const ALARM_SUMMARY_PROPERTIES = {
  id: {
    type: 'string',
    description: 'Alarm OCID',
  },
  displayName: {
    type: 'string',
    description: 'Display name',
  },
  compartmentId: {
    type: 'string',
    description: 'Alarm compartment OCID',
  },
  metricCompartmentId: {
    type: 'string',
    description: 'Metric compartment OCID',
  },
  namespace: {
    type: 'string',
    description: 'Metric namespace',
  },
  resourceGroup: {
    type: 'string',
    description: 'Resource group',
    optional: true,
  },
  query: {
    type: 'string',
    description: 'Alarm MQL expression',
  },
  severity: {
    type: 'string',
    description: 'Alarm severity',
  },
  isEnabled: {
    type: 'boolean',
    description: 'Whether evaluation is enabled',
  },
  lifecycleState: {
    type: 'string',
    description: 'Resource lifecycle state',
  },
  destinations: {
    type: 'array',
    description: 'Existing Notifications topic or Streaming stream OCIDs',
    items: {
      type: 'string',
    },
  },
  suppression: {
    type: 'json',
    description: 'Inline alarm suppression',
    properties: {
      description: {
        type: 'string',
        description: 'Suppression reason',
        optional: true,
      },
      timeSuppressFrom: {
        type: 'string',
        description: 'Inclusive suppression start (RFC3339)',
      },
      timeSuppressUntil: {
        type: 'string',
        description: 'Inclusive suppression end (RFC3339)',
      },
    },
    optional: true,
  },
  ruleName: {
    type: 'string',
    description: 'rule Name',
    optional: true,
  },
  notificationVersion: {
    type: 'string',
    description: 'notification Version',
    optional: true,
  },
  notificationTitle: {
    type: 'string',
    description: 'notification Title',
    optional: true,
  },
  evaluationSlackDuration: {
    type: 'string',
    description: 'evaluation Slack Duration',
    optional: true,
  },
  alarmSummary: {
    type: 'string',
    description: 'alarm Summary',
    optional: true,
  },
  isNotificationsPerMetricDimensionEnabled: {
    type: 'boolean',
    description: 'Whether notifications are split by metric dimension',
    optional: true,
  },
  freeformTags: {
    type: 'json',
    description: 'Freeform tag names and string values',
    optional: true,
  },
  definedTags: {
    type: 'json',
    description: 'Tag namespaces and values',
    optional: true,
  },
  overrides: {
    type: 'array',
    description: 'Additional alarm trigger rules',
    items: {
      type: 'object',
      properties: {
        ruleName: {
          type: 'string',
          description: 'Rule name',
          optional: true,
        },
        query: {
          type: 'string',
          description: 'Rule MQL',
          optional: true,
        },
        severity: {
          type: 'string',
          description: 'Rule severity',
          optional: true,
        },
        pendingDuration: {
          type: 'string',
          description: 'Time before firing',
          optional: true,
        },
        body: {
          type: 'string',
          description: 'Message body',
          optional: true,
        },
      },
    },
    optional: true,
  },
} as const

const ALARM_PROPERTIES = {
  id: {
    type: 'string',
    description: 'Alarm OCID',
  },
  displayName: {
    type: 'string',
    description: 'Display name',
  },
  compartmentId: {
    type: 'string',
    description: 'Alarm compartment OCID',
  },
  metricCompartmentId: {
    type: 'string',
    description: 'Metric compartment OCID',
  },
  metricCompartmentIdInSubtree: {
    type: 'boolean',
    description: 'Whether child compartments are evaluated',
    optional: true,
  },
  namespace: {
    type: 'string',
    description: 'Metric namespace',
  },
  resourceGroup: {
    type: 'string',
    description: 'Resource group',
    optional: true,
  },
  query: {
    type: 'string',
    description: 'Alarm MQL expression',
  },
  severity: {
    type: 'string',
    description: 'Alarm severity',
  },
  isEnabled: {
    type: 'boolean',
    description: 'Whether evaluation is enabled',
  },
  lifecycleState: {
    type: 'string',
    description: 'Resource lifecycle state',
  },
  destinations: {
    type: 'array',
    description: 'Existing Notifications topic or Streaming stream OCIDs',
    items: {
      type: 'string',
    },
  },
  suppression: {
    type: 'json',
    description: 'Inline alarm suppression',
    properties: {
      description: {
        type: 'string',
        description: 'Suppression reason',
        optional: true,
      },
      timeSuppressFrom: {
        type: 'string',
        description: 'Inclusive suppression start (RFC3339)',
      },
      timeSuppressUntil: {
        type: 'string',
        description: 'Inclusive suppression end (RFC3339)',
      },
    },
    optional: true,
  },
  resolution: {
    type: 'string',
    description: 'resolution',
    optional: true,
  },
  pendingDuration: {
    type: 'string',
    description: 'pending Duration',
    optional: true,
  },
  body: {
    type: 'string',
    description: 'body',
    optional: true,
  },
  messageFormat: {
    type: 'string',
    description: 'message Format',
    optional: true,
  },
  repeatNotificationDuration: {
    type: 'string',
    description: 'repeat Notification Duration',
    optional: true,
  },
  ruleName: {
    type: 'string',
    description: 'rule Name',
    optional: true,
  },
  notificationVersion: {
    type: 'string',
    description: 'notification Version',
    optional: true,
  },
  notificationTitle: {
    type: 'string',
    description: 'notification Title',
    optional: true,
  },
  evaluationSlackDuration: {
    type: 'string',
    description: 'evaluation Slack Duration',
    optional: true,
  },
  alarmSummary: {
    type: 'string',
    description: 'alarm Summary',
    optional: true,
  },
  timeCreated: {
    type: 'string',
    description: 'time Created',
    optional: true,
  },
  timeUpdated: {
    type: 'string',
    description: 'time Updated',
    optional: true,
  },
  isNotificationsPerMetricDimensionEnabled: {
    type: 'boolean',
    description: 'Whether notifications are split by metric dimension',
    optional: true,
  },
  freeformTags: {
    type: 'json',
    description: 'Freeform tag names and string values',
    optional: true,
  },
  definedTags: {
    type: 'json',
    description: 'Tag namespaces and values',
    optional: true,
  },
  overrides: {
    type: 'array',
    description: 'Additional alarm trigger rules',
    items: {
      type: 'object',
      properties: {
        ruleName: {
          type: 'string',
          description: 'Rule name',
          optional: true,
        },
        query: {
          type: 'string',
          description: 'Rule MQL',
          optional: true,
        },
        severity: {
          type: 'string',
          description: 'Rule severity',
          optional: true,
        },
        pendingDuration: {
          type: 'string',
          description: 'Time before firing',
          optional: true,
        },
        body: {
          type: 'string',
          description: 'Message body',
          optional: true,
        },
      },
    },
    optional: true,
  },
} as const

const SUPPRESSION_PROPERTIES = {
  id: {
    type: 'string',
    description: 'Suppression OCID',
  },
  compartmentId: {
    type: 'string',
    description: 'Suppression compartment OCID',
  },
  alarmSuppressionTarget: {
    type: 'json',
    description: 'Suppression target',
    properties: {
      targetType: {
        type: 'string',
        description: 'ALARM or COMPARTMENT',
      },
      alarmId: {
        type: 'string',
        description: 'Target alarm OCID',
        optional: true,
      },
      compartmentId: {
        type: 'string',
        description: 'Target compartment OCID',
        optional: true,
      },
      compartmentIdInSubtree: {
        type: 'boolean',
        description: 'Whether descendants are targeted',
        optional: true,
      },
    },
  },
  level: {
    type: 'string',
    description: 'ALARM or DIMENSION',
  },
  displayName: {
    type: 'string',
    description: 'Display name',
  },
  description: {
    type: 'string',
    description: 'Reason',
    optional: true,
  },
  dimensions: {
    type: 'json',
    description: 'Suppressed dimension names and values',
    optional: true,
  },
  timeSuppressFrom: {
    type: 'string',
    description: 'Inclusive suppression start',
  },
  timeSuppressUntil: {
    type: 'string',
    description: 'Inclusive suppression end',
  },
  lifecycleState: {
    type: 'string',
    description: 'Resource lifecycle state',
  },
  timeCreated: {
    type: 'string',
    description: 'Creation timestamp',
    optional: true,
  },
  timeUpdated: {
    type: 'string',
    description: 'Update timestamp',
    optional: true,
  },
  suppressionConditions: {
    type: 'array',
    description: 'Suppression preconditions',
    items: {
      type: 'object',
      properties: {
        conditionType: {
          type: 'string',
          description: 'Suppression condition type',
        },
        suppressionRecurrence: {
          type: 'string',
          description: 'Recurrence expression',
          optional: true,
        },
        suppressionDuration: {
          type: 'string',
          description: 'Duration of each recurrence',
          optional: true,
        },
      },
    },
    optional: true,
  },
  freeformTags: {
    type: 'json',
    description: 'Freeform tags',
    optional: true,
  },
  definedTags: {
    type: 'json',
    description: 'Defined tags',
    optional: true,
  },
} as const

export const OCI_REQUEST_OUTPUTS = {
  opcRequestId: {
    type: 'string',
    description: 'Oracle request ID',
    optional: true,
  },
} as const

export const OCI_METRICS_OUTPUTS = {
  ...OCI_REQUEST_OUTPUTS,
  metrics: {
    type: 'array',
    description: 'Discovered metric definitions; grouping can omit non-grouped fields',
    items: {
      type: 'object',
      properties: METRIC_PROPERTIES,
    },
  },
  nextPage: {
    type: 'string',
    description: 'Opaque token for the next page; null when complete',
    optional: true,
  },
} as const

export const OCI_METRIC_DATA_OUTPUTS = {
  ...OCI_REQUEST_OUTPUTS,
  metricData: {
    type: 'array',
    description: 'Aggregated metric time series',
    items: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Metric name',
          optional: true,
        },
        namespace: {
          type: 'string',
          description: 'Metric namespace',
          optional: true,
        },
        resourceGroup: {
          type: 'string',
          description: 'Resource group',
          optional: true,
        },
        compartmentId: {
          type: 'string',
          description: 'Metric compartment OCID',
          optional: true,
        },
        dimensions: {
          type: 'json',
          description: 'Dimension names and string values',
          optional: true,
        },
        metadata: {
          type: 'json',
          description: 'Metric metadata such as unit',
          optional: true,
        },
        resolution: {
          type: 'string',
          description: 'Aggregation spacing',
          optional: true,
        },
        aggregatedDatapoints: {
          type: 'array',
          description: 'Aggregated datapoints',
          items: {
            type: 'object',
            properties: {
              timestamp: {
                type: 'string',
                description: 'Datapoint timestamp (RFC3339)',
              },
              value: {
                type: 'number',
                description: 'Aggregated value',
              },
            },
          },
        },
      },
    },
  },
} as const

export const OCI_ALARMS_OUTPUTS = {
  ...OCI_REQUEST_OUTPUTS,
  alarms: {
    type: 'array',
    description: 'Alarm definitions',
    items: {
      type: 'object',
      properties: ALARM_SUMMARY_PROPERTIES,
    },
  },
  nextPage: {
    type: 'string',
    description: 'Opaque token for the next page; null when complete',
    optional: true,
  },
} as const

export const OCI_ALARM_OUTPUTS = {
  ...OCI_REQUEST_OUTPUTS,
  alarm: {
    type: 'json',
    description: 'Alarm configuration',
    properties: ALARM_PROPERTIES,
  },
  etag: {
    type: 'string',
    description: 'Concurrency ETag',
    optional: true,
  },
} as const

export const OCI_ALARM_STATUSES_OUTPUTS = {
  ...OCI_REQUEST_OUTPUTS,
  alarmStatuses: {
    type: 'array',
    description: 'Aggregate alarm statuses',
    items: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Alarm OCID',
        },
        displayName: {
          type: 'string',
          description: 'Display name',
        },
        severity: {
          type: 'string',
          description: 'Severity',
        },
        ruleName: {
          type: 'string',
          description: 'Rule name',
          optional: true,
        },
        timestampTriggered: {
          type: 'string',
          description: 'Last trigger timestamp',
          optional: true,
        },
        alarmSummary: {
          type: 'string',
          description: 'Alarm summary',
          optional: true,
        },
        status: {
          type: 'string',
          description: 'Aggregate alarm status',
        },
        suppression: {
          type: 'json',
          description: 'Inline alarm suppression',
          properties: {
            description: {
              type: 'string',
              description: 'Suppression reason',
              optional: true,
            },
            timeSuppressFrom: {
              type: 'string',
              description: 'Inclusive suppression start (RFC3339)',
            },
            timeSuppressUntil: {
              type: 'string',
              description: 'Inclusive suppression end (RFC3339)',
            },
          },
          optional: true,
        },
      },
    },
  },
  nextPage: {
    type: 'string',
    description: 'Opaque token for the next page; null when complete',
    optional: true,
  },
} as const

export const OCI_HISTORY_OUTPUTS = {
  ...OCI_REQUEST_OUTPUTS,
  alarmId: {
    type: 'string',
    description: 'Alarm OCID',
  },
  isEnabled: {
    type: 'boolean',
    description: 'Whether the alarm is enabled',
  },
  history: {
    type: 'array',
    description: 'Alarm history entries',
    items: {
      type: 'object',
      properties: {
        alarmSummary: {
          type: 'string',
          description: 'Alarm summary',
          optional: true,
        },
        summary: {
          type: 'string',
          description: 'History entry summary',
          optional: true,
        },
        timestamp: {
          type: 'string',
          description: 'Entry timestamp',
        },
        timestampTriggered: {
          type: 'string',
          description: 'Trigger timestamp',
          optional: true,
        },
      },
    },
  },
  nextPage: {
    type: 'string',
    description: 'Opaque token for the next page; null when complete',
    optional: true,
  },
} as const

export const OCI_DIMENSION_STATES_OUTPUTS = {
  ...OCI_REQUEST_OUTPUTS,
  alarmId: {
    type: 'string',
    description: 'Alarm OCID',
  },
  isEnabled: {
    type: 'boolean',
    description: 'Whether the alarm is enabled',
  },
  isNotificationsPerMetricDimensionEnabled: {
    type: 'boolean',
    description: 'Whether notifications are split',
  },
  dimensionStates: {
    type: 'array',
    description: 'Individual metric stream states',
    items: {
      type: 'object',
      properties: {
        alarmSummary: {
          type: 'string',
          description: 'Alarm summary',
          optional: true,
        },
        dimensions: {
          type: 'json',
          description: 'Metric stream dimensions',
          optional: true,
        },
        status: {
          type: 'string',
          description: 'Metric stream status',
        },
        ruleName: {
          type: 'string',
          description: 'Rule name',
          optional: true,
        },
        timestamp: {
          type: 'string',
          description: 'State timestamp',
        },
      },
    },
  },
  nextPage: {
    type: 'string',
    description: 'Opaque token for the next page; null when complete',
    optional: true,
  },
} as const

export const OCI_ALARM_SUPPRESSION_OUTPUTS = {
  ...OCI_REQUEST_OUTPUTS,
  alarmSuppression: {
    type: 'json',
    description: 'Suppression configuration',
    properties: SUPPRESSION_PROPERTIES,
  },
  etag: {
    type: 'string',
    description: 'Concurrency ETag',
    optional: true,
  },
} as const

export const OCI_ALARM_SUPPRESSIONS_OUTPUTS = {
  ...OCI_REQUEST_OUTPUTS,
  alarmSuppressions: {
    type: 'array',
    description: 'Suppression resources',
    items: {
      type: 'object',
      properties: SUPPRESSION_PROPERTIES,
    },
  },
  nextPage: {
    type: 'string',
    description: 'Opaque token for the next page; null when complete',
    optional: true,
  },
} as const

export const OCI_SUPPRESSION_HISTORY_OUTPUTS = {
  ...OCI_REQUEST_OUTPUTS,
  suppressionHistory: {
    type: 'array',
    description: 'Effective suppression history',
    items: {
      type: 'object',
      properties: {
        suppressionId: {
          type: 'string',
          description: 'Suppression OCID',
        },
        alarmSuppressionTarget: {
          type: 'json',
          description: 'Suppression target',
          properties: {
            targetType: {
              type: 'string',
              description: 'ALARM or COMPARTMENT',
            },
            alarmId: {
              type: 'string',
              description: 'Target alarm OCID',
              optional: true,
            },
            compartmentId: {
              type: 'string',
              description: 'Target compartment OCID',
              optional: true,
            },
            compartmentIdInSubtree: {
              type: 'boolean',
              description: 'Whether descendants are targeted',
              optional: true,
            },
          },
        },
        level: {
          type: 'string',
          description: 'Suppression level',
        },
        displayName: {
          type: 'string',
          description: 'Display name',
        },
        description: {
          type: 'string',
          description: 'Suppression reason',
          optional: true,
        },
        dimensions: {
          type: 'json',
          description: 'Suppressed dimensions',
          optional: true,
        },
        timeEffectiveFrom: {
          type: 'string',
          description: 'Effective start',
        },
        timeEffectiveUntil: {
          type: 'string',
          description: 'Effective end',
          optional: true,
        },
        suppressionConditions: {
          type: 'array',
          description: 'Suppression preconditions',
          items: {
            type: 'object',
            properties: {
              conditionType: {
                type: 'string',
                description: 'Suppression condition type',
              },
              suppressionRecurrence: {
                type: 'string',
                description: 'Recurrence expression',
                optional: true,
              },
              suppressionDuration: {
                type: 'string',
                description: 'Duration of each recurrence',
                optional: true,
              },
            },
          },
          optional: true,
        },
      },
    },
  },
  nextPage: {
    type: 'string',
    description: 'Opaque token for the next page; null when complete',
    optional: true,
  },
} as const

export const OCI_INGESTION_OUTPUTS = {
  ...OCI_REQUEST_OUTPUTS,
  failedMetricsCount: {
    type: 'number',
    description: 'Number of rejected metric records',
  },
  failedMetrics: {
    type: 'array',
    description: 'Rejected metric records and their validation errors',
    items: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Validation failure reason',
        },
        metricData: {
          type: 'json',
          description: 'Metric record rejected by Oracle',
          properties: {
            name: {
              type: 'string',
              description: 'Metric name',
              optional: true,
            },
            namespace: {
              type: 'string',
              description: 'Metric namespace',
              optional: true,
            },
            resourceGroup: {
              type: 'string',
              description: 'Resource group',
              optional: true,
            },
            compartmentId: {
              type: 'string',
              description: 'Metric compartment OCID',
              optional: true,
            },
            dimensions: {
              type: 'json',
              description: 'Dimension names and string values',
              optional: true,
            },
            datapoints: {
              type: 'array',
              description: 'Submitted datapoints',
              items: {
                type: 'object',
                properties: {
                  timestamp: {
                    type: 'string',
                    description: 'Raw datapoint timestamp',
                  },
                  value: {
                    type: 'number',
                    description: 'Raw metric value',
                  },
                  count: {
                    type: 'number',
                    description: 'Sample count',
                    optional: true,
                  },
                },
              },
            },
            metadata: {
              type: 'json',
              description: 'Metric metadata',
              optional: true,
            },
          },
        },
      },
    },
  },
} as const
