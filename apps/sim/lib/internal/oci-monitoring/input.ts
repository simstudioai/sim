import { z } from 'zod'

const id = z.string().trim().min(1).max(512)
const text = z.string().min(1).max(4096)
const timestamp = z.string().datetime({ offset: true })
const historyTimestamp = timestamp.refine(
  (value) => Date.parse(value) <= Date.now(),
  'Suppression history timestamps cannot be in the future'
)
const strings = z.record(z.string(), z.string())
const dimensions = strings.refine((value) => JSON.stringify(value).length <= 4000, {
  message: 'Dimensions must not exceed 4000 serialized characters',
})

/** JSON fields accept both resolved workflow objects and the block's JSON editor text. */
function json<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => {
    if (typeof value !== 'string' || value.length > 1024 * 1024) return value
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }, schema)
}

const connection = {
  oauthCredential: id,
  region: z.string().trim().min(1).max(128).optional(),
}
const page = {
  limit: z.number().int().min(1).max(1000).default(100),
  page: z.string().min(1).max(4096).optional(),
}
const compartment = {
  compartmentId: id,
  compartmentIdInSubtree: z.boolean().optional(),
}
const sort = { sortOrder: z.enum(['ASC', 'DESC']).optional() }
const alarmId = { alarmId: id }
const ifMatch = { ifMatch: z.string().min(1).max(1024).optional() }
const retryToken = { opcRetryToken: z.string().min(1).max(64).optional() }
const severity = z.enum(['CRITICAL', 'ERROR', 'WARNING', 'INFO'])
const suppression = z.object({
  description: z.string().max(4000).optional(),
  timeSuppressFrom: timestamp,
  timeSuppressUntil: timestamp,
})
const tags = {
  freeformTags: json(strings).optional(),
  definedTags: json(z.record(z.string(), z.record(z.string(), z.unknown()))).optional(),
}
const alarmFields = {
  displayName: z.string().min(1).max(256),
  compartmentId: id,
  metricCompartmentId: id,
  metricCompartmentIdInSubtree: z.boolean().optional(),
  namespace: text,
  resourceGroup: text.nullable().optional(),
  query: text,
  resolution: z.literal('1m').optional(),
  pendingDuration: z.string().min(1).max(64).optional(),
  severity,
  body: z.string().max(4000).optional(),
  isNotificationsPerMetricDimensionEnabled: z.boolean().optional(),
  messageFormat: z.enum(['RAW', 'PRETTY_JSON', 'ONS_OPTIMIZED']).optional(),
  destinations: json(z.array(id).min(1).max(2)),
  repeatNotificationDuration: z.string().min(1).max(64).optional(),
  suppression: json(suppression).optional(),
  isEnabled: z.boolean(),
  ...tags,
  overrides: json(
    z
      .array(
        z.object({
          ruleName: z.string().min(1).max(64).optional(),
          query: text.optional(),
          severity: severity.optional(),
          pendingDuration: z.string().min(1).max(64).optional(),
          body: z.string().max(4000).optional(),
        })
      )
      .max(2)
  ).optional(),
  ruleName: z.string().min(1).max(64).optional(),
  notificationVersion: z.string().min(1).max(64).optional(),
  notificationTitle: z.string().max(256).optional(),
  evaluationSlackDuration: z.string().min(1).max(64).optional(),
  alarmSummary: z.string().max(4000).optional(),
}
const metricDimensions = z
  .record(
    z
      .string()
      .min(1)
      .max(256)
      .regex(/^[\x21-\x7e]+$/),
    z.string().min(1).max(512)
  )
  .refine((value) => Object.keys(value).length >= 1 && Object.keys(value).length <= 20, {
    message: 'Each metric must have between 1 and 20 dimensions',
  })
const metric = z.object({
  compartmentId: id,
  namespace: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
    .refine(
      (value) => !value.startsWith('oci_') && !value.startsWith('oracle_'),
      'Custom namespaces cannot use the oci_ or oracle_ prefixes'
    ),
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9._$-]*$/),
  resourceGroup: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9._$-]*$/)
    .optional(),
  dimensions: metricDimensions,
  metadata: z.record(z.string().min(1).max(256), z.string().max(256)).optional(),
  datapoints: z
    .array(
      z.object({
        timestamp,
        value: z.number().finite(),
        count: z.number().int().min(1).optional(),
      })
    )
    .min(1)
    .max(100000),
})

export const ociMonitoringInputSchemas = {
  list_metrics: z.object({
    ...connection,
    ...compartment,
    ...page,
    ...sort,
    name: text.optional(),
    namespace: text.optional(),
    resourceGroup: text.nullable().optional(),
    dimensionFilters: json(strings).optional(),
    groupBy: json(
      z
        .array(z.enum(['namespace', 'name', 'resourceGroup']))
        .min(1)
        .max(3)
    ).optional(),
    sortBy: z.enum(['NAMESPACE', 'NAME', 'RESOURCEGROUP']).optional(),
  }),
  summarize_metrics_data: z
    .object({
      ...connection,
      ...compartment,
      namespace: text,
      query: text,
      resourceGroup: text.nullable().optional(),
      startTime: timestamp.optional(),
      endTime: timestamp.optional(),
      resolution: z
        .string()
        .regex(/^(?:[1-9]|[1-5][0-9]|60)m$|^(?:[1-9]|1[0-9]|2[0-4])h$|^1d$/)
        .optional(),
      maxStreams: z.number().int().min(1).max(2000).default(100),
      maxDatapoints: z.number().int().min(1).max(100000).default(10000),
    })
    .refine(
      (value) =>
        !value.startTime ||
        !value.endTime ||
        Date.parse(value.startTime) < Date.parse(value.endTime),
      { message: 'Start time must precede end time', path: ['endTime'] }
    ),
  post_metric_data: z.object({
    ...connection,
    metricData: json(z.array(metric).min(1).max(50)),
    batchAtomicity: z.enum(['ATOMIC', 'NON_ATOMIC']).optional(),
  }),
  list_alarms: z.object({
    ...connection,
    ...compartment,
    ...page,
    ...sort,
    displayName: text.optional(),
    lifecycleState: z.enum(['ACTIVE', 'DELETING', 'DELETED']).optional(),
    sortBy: z.enum(['displayName', 'severity']).optional(),
  }),
  list_alarms_status: z.object({
    ...connection,
    ...compartment,
    ...page,
    ...sort,
    displayName: text.optional(),
    sortBy: z.enum(['displayName', 'severity']).optional(),
    resourceId: id.optional(),
    serviceName: text.optional(),
    entityId: id.optional(),
    status: z.enum(['FIRING', 'OK']).optional(),
  }),
  get_alarm: z.object({ ...connection, ...alarmId }),
  get_alarm_history: z.object({
    ...connection,
    ...alarmId,
    ...page,
    alarmHistorytype: z
      .enum([
        'STATE_HISTORY',
        'STATE_TRANSITION_HISTORY',
        'RULE_HISTORY',
        'RULE_TRANSITION_HISTORY',
      ])
      .optional(),
    timestampGreaterThanOrEqualTo: timestamp.optional(),
    timestampLessThan: timestamp.optional(),
  }),
  retrieve_dimension_states: z.object({
    ...connection,
    ...alarmId,
    ...page,
    dimensionFilters: json(strings).optional(),
    status: z.enum(['FIRING', 'OK']).optional(),
  }),
  create_alarm: z.object({ ...connection, ...alarmFields, ...retryToken }),
  update_alarm: z.object({
    ...connection,
    ...alarmId,
    ...ifMatch,
    ...z.object(alarmFields).partial().shape,
  }),
  delete_alarm: z.object({ ...connection, ...alarmId, ...ifMatch }),
  create_alarm_suppression: z
    .object({
      ...connection,
      ...alarmId,
      ...retryToken,
      ...tags,
      displayName: z.string().min(1).max(256),
      description: z.string().max(4000).optional(),
      level: z.enum(['ALARM', 'DIMENSION']).default('ALARM'),
      dimensions: json(dimensions).optional(),
      timeSuppressFrom: timestamp,
      timeSuppressUntil: timestamp,
    })
    .superRefine((value, context) => {
      if (Date.parse(value.timeSuppressFrom) >= Date.parse(value.timeSuppressUntil)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Suppression end must follow its start',
          path: ['timeSuppressUntil'],
        })
      }
      if (
        value.level === 'DIMENSION' &&
        (!value.dimensions || !Object.keys(value.dimensions).length)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Dimension suppression requires nonempty dimensions',
          path: ['dimensions'],
        })
      }
      if (value.level === 'ALARM' && value.dimensions && Object.keys(value.dimensions).length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Alarm-wide suppression does not take dimensions',
          path: ['dimensions'],
        })
      }
    }),
  list_alarm_suppressions: z.object({
    ...connection,
    ...alarmId,
    ...page,
    ...sort,
    displayName: text.optional(),
    lifecycleState: z.enum(['ACTIVE', 'DELETED']).optional(),
    level: z.enum(['ALARM', 'DIMENSION']).optional(),
    isAllSuppressions: z.boolean().optional(),
    sortBy: z.enum(['displayName', 'timeCreated', 'timeSuppressFrom']).optional(),
  }),
  get_alarm_suppression: z.object({ ...connection, alarmSuppressionId: id }),
  delete_alarm_suppression: z.object({ ...connection, alarmSuppressionId: id, ...ifMatch }),
  summarize_alarm_suppression_history: z.object({
    ...connection,
    ...alarmId,
    ...page,
    dimensions: json(strings).optional(),
    timeSuppressFromGreaterThanOrEqualTo: historyTimestamp.optional(),
    timeSuppressFromLessThan: historyTimestamp.optional(),
  }),
  remove_alarm_suppression: z.object({ ...connection, ...alarmId, ...ifMatch }),
} as const

export type OciMonitoringOperation = keyof typeof ociMonitoringInputSchemas
export type OciMonitoringInput<K extends OciMonitoringOperation = OciMonitoringOperation> =
  z.output<(typeof ociMonitoringInputSchemas)[K]>
export type OciMonitoringParams<K extends OciMonitoringOperation = OciMonitoringOperation> =
  z.input<(typeof ociMonitoringInputSchemas)[K]>
