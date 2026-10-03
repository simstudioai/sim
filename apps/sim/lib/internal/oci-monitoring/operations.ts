import { z } from 'zod'
import type { OciClient, OciRequest } from '@/lib/internal/oci/client.server'
import { createOciStaticEndpointPolicy } from '@/lib/internal/oci/endpoints'
import type {
  OciMonitoringInput,
  OciMonitoringOperation,
} from '@/lib/internal/oci-monitoring/input'
import type { ToolResponse } from '@/tools/types'

export const OCI_MONITORING_ENDPOINT = createOciStaticEndpointPolicy({
  serviceId: 'oci_monitoring',
  serviceName: 'telemetry',
  hostnameTemplate: 'regional',
})
const INGESTION_ENDPOINT = createOciStaticEndpointPolicy({
  serviceId: 'oci_monitoring',
  serviceName: 'telemetry-ingestion',
  hostnameTemplate: 'regional',
})
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const MAX_REQUEST_BYTES = 1024 * 1024
const TIMEOUT_MS = 60_000
const optionalString = z.string().nullable().optional()
const optionalBoolean = z.boolean().nullable().optional()
const stringMap = z.record(z.string(), z.string())
const tags = {
  freeformTags: stringMap.nullable().optional(),
  definedTags: z.record(z.string(), z.record(z.string(), z.unknown())).nullable().optional(),
}
const suppressionSchema = z.object({
  description: optionalString,
  timeSuppressFrom: z.string(),
  timeSuppressUntil: z.string(),
})
const overrideSchema = z.object({
  ruleName: optionalString,
  query: optionalString,
  severity: optionalString,
  pendingDuration: optionalString,
  body: optionalString,
})
const metricSchema = z.object({
  name: optionalString,
  namespace: optionalString,
  resourceGroup: optionalString,
  compartmentId: optionalString,
  dimensions: stringMap.nullable().optional(),
})
const datapointSchema = z.object({ timestamp: z.string(), value: z.number() })
const metricDataSchema = z.object({
  namespace: z.string(),
  name: z.string(),
  compartmentId: z.string(),
  dimensions: stringMap,
  resourceGroup: optionalString,
  metadata: stringMap.nullable().optional(),
  resolution: optionalString,
  aggregatedDatapoints: z.array(datapointSchema),
})
const alarmSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  compartmentId: z.string(),
  metricCompartmentId: z.string(),
  metricCompartmentIdInSubtree: optionalBoolean,
  namespace: z.string(),
  resourceGroup: optionalString,
  query: z.string(),
  resolution: optionalString,
  pendingDuration: optionalString,
  severity: z.string(),
  body: optionalString,
  isNotificationsPerMetricDimensionEnabled: optionalBoolean,
  messageFormat: optionalString,
  destinations: z.array(z.string()),
  repeatNotificationDuration: optionalString,
  suppression: suppressionSchema.nullable().optional(),
  isEnabled: z.boolean(),
  ...tags,
  overrides: z.array(overrideSchema).nullable().optional(),
  ruleName: optionalString,
  notificationVersion: optionalString,
  notificationTitle: optionalString,
  evaluationSlackDuration: optionalString,
  alarmSummary: optionalString,
  lifecycleState: z.string(),
  timeCreated: optionalString,
  timeUpdated: optionalString,
})
const alarmStatusSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  severity: z.string(),
  ruleName: optionalString,
  timestampTriggered: optionalString,
  alarmSummary: optionalString,
  status: z.string(),
  suppression: suppressionSchema.nullable().optional(),
})
const alarmSummarySchema = alarmSchema.omit({
  metricCompartmentIdInSubtree: true,
  resolution: true,
  pendingDuration: true,
  body: true,
  messageFormat: true,
  repeatNotificationDuration: true,
  timeCreated: true,
  timeUpdated: true,
})
const historyEntrySchema = z.object({
  alarmSummary: optionalString,
  summary: optionalString,
  timestamp: z.string(),
  timestampTriggered: optionalString,
})
const dimensionStateSchema = z.object({
  alarmSummary: optionalString,
  dimensions: stringMap,
  status: z.string(),
  ruleName: optionalString,
  timestamp: z.string(),
})
const targetSchema = z.object({
  targetType: z.string(),
  alarmId: optionalString,
  compartmentId: optionalString,
  compartmentIdInSubtree: optionalBoolean,
})
const conditionSchema = z.object({
  conditionType: z.string(),
  suppressionRecurrence: optionalString,
  suppressionDuration: optionalString,
})
const alarmSuppressionSchema = z.object({
  id: z.string(),
  compartmentId: z.string(),
  alarmSuppressionTarget: targetSchema,
  level: z.string(),
  displayName: z.string(),
  description: optionalString,
  dimensions: stringMap.nullable().optional(),
  timeSuppressFrom: z.string(),
  timeSuppressUntil: z.string(),
  lifecycleState: z.string(),
  timeCreated: optionalString,
  timeUpdated: optionalString,
  suppressionConditions: z.array(conditionSchema).nullable().optional(),
  ...tags,
})
const suppressionHistorySchema = z.object({
  suppressionId: z.string(),
  alarmSuppressionTarget: targetSchema,
  level: z.string(),
  displayName: z.string(),
  description: optionalString,
  dimensions: stringMap.nullable().optional(),
  timeEffectiveFrom: z.string(),
  timeEffectiveUntil: optionalString,
  suppressionConditions: z.array(conditionSchema).nullable().optional(),
})
const postedMetricSchema = z.object({
  compartmentId: z.string(),
  namespace: z.string(),
  name: z.string(),
  resourceGroup: optionalString,
  dimensions: stringMap,
  metadata: stringMap.nullable().optional(),
  datapoints: z.array(datapointSchema.extend({ count: z.number().optional() })),
})
const failedMetricSchema = z.object({
  message: z.string(),
  metricData: postedMetricSchema,
})

export type OciMetric = z.output<typeof metricSchema>
export type OciMetricData = z.output<typeof metricDataSchema>
export type OciAlarm = z.output<typeof alarmSchema>
export type OciAlarmSummary = z.output<typeof alarmSummarySchema>
export type OciAlarmStatus = z.output<typeof alarmStatusSchema>
export type OciAlarmHistoryEntry = z.output<typeof historyEntrySchema>
export type OciDimensionState = z.output<typeof dimensionStateSchema>
export type OciAlarmSuppression = z.output<typeof alarmSuppressionSchema>
export type OciSuppressionHistory = z.output<typeof suppressionHistorySchema>
export type OciFailedMetric = z.output<typeof failedMetricSchema>

export class OciMonitoringInputError extends Error {}

const ALARM_FIELDS = [
  'displayName',
  'compartmentId',
  'metricCompartmentId',
  'metricCompartmentIdInSubtree',
  'namespace',
  'resourceGroup',
  'query',
  'resolution',
  'pendingDuration',
  'severity',
  'body',
  'isNotificationsPerMetricDimensionEnabled',
  'messageFormat',
  'destinations',
  'repeatNotificationDuration',
  'suppression',
  'isEnabled',
  'freeformTags',
  'definedTags',
  'overrides',
  'ruleName',
  'notificationVersion',
  'notificationTitle',
  'evaluationSlackDuration',
  'alarmSummary',
] as const
const PAGE_FIELDS = ['page', 'limit'] as const
const COMPARTMENT_FIELDS = ['compartmentId', 'compartmentIdInSubtree'] as const
const ALARM_LIST_FIELDS = [
  ...COMPARTMENT_FIELDS,
  ...PAGE_FIELDS,
  'displayName',
  'sortBy',
  'sortOrder',
] as const

interface OperationRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  query?: readonly string[]
  body?: readonly string[]
  tokenized?: boolean
}

/** Monitoring owns its wire contracts; the shared OCI client owns transport and signing. */
function operationRequest(
  operation: OciMonitoringOperation,
  input: Record<string, unknown>
): OperationRequest {
  const alarmPath = `/alarms/${encodeURIComponent(String(input.alarmId))}`
  const suppressionPath = `/alarmSuppressions/${encodeURIComponent(String(input.alarmSuppressionId))}`
  switch (operation) {
    case 'list_metrics':
      return {
        method: 'POST',
        path: '/metrics/actions/listMetrics',
        query: [...COMPARTMENT_FIELDS, ...PAGE_FIELDS],
        body: [
          'name',
          'namespace',
          'resourceGroup',
          'dimensionFilters',
          'groupBy',
          'sortBy',
          'sortOrder',
        ],
      }
    case 'summarize_metrics_data':
      return {
        method: 'POST',
        path: '/metrics/actions/summarizeMetricsData',
        query: COMPARTMENT_FIELDS,
        body: ['namespace', 'query', 'resourceGroup', 'startTime', 'endTime', 'resolution'],
      }
    case 'post_metric_data':
      return { method: 'POST', path: '/metrics', body: ['metricData', 'batchAtomicity'] }
    case 'list_alarms':
      return { method: 'GET', path: '/alarms', query: [...ALARM_LIST_FIELDS, 'lifecycleState'] }
    case 'list_alarms_status':
      return {
        method: 'GET',
        path: '/alarms/status',
        query: [...ALARM_LIST_FIELDS, 'resourceId', 'serviceName', 'entityId', 'status'],
      }
    case 'get_alarm':
      return { method: 'GET', path: alarmPath }
    case 'get_alarm_history':
      return {
        method: 'GET',
        path: `${alarmPath}/history`,
        query: [
          ...PAGE_FIELDS,
          'alarmHistorytype',
          'timestampGreaterThanOrEqualTo',
          'timestampLessThan',
        ],
      }
    case 'retrieve_dimension_states':
      return {
        method: 'POST',
        path: `${alarmPath}/actions/retrieveDimensionStates`,
        query: PAGE_FIELDS,
        body: ['dimensionFilters', 'status'],
      }
    case 'create_alarm':
      return { method: 'POST', path: '/alarms', body: ALARM_FIELDS, tokenized: true }
    case 'update_alarm':
      return { method: 'PUT', path: alarmPath, body: ALARM_FIELDS }
    case 'delete_alarm':
      return { method: 'DELETE', path: alarmPath }
    case 'create_alarm_suppression':
      return {
        method: 'POST',
        path: '/alarmSuppressions',
        body: [
          'displayName',
          'description',
          'level',
          'dimensions',
          'timeSuppressFrom',
          'timeSuppressUntil',
          'freeformTags',
          'definedTags',
        ],
        tokenized: true,
      }
    case 'list_alarm_suppressions':
      return {
        method: 'GET',
        path: '/alarmSuppressions',
        query: [
          ...PAGE_FIELDS,
          'alarmId',
          'displayName',
          'lifecycleState',
          'level',
          'isAllSuppressions',
          'sortBy',
          'sortOrder',
        ],
      }
    case 'get_alarm_suppression':
      return { method: 'GET', path: suppressionPath }
    case 'delete_alarm_suppression':
      return { method: 'DELETE', path: suppressionPath }
    case 'summarize_alarm_suppression_history':
      return {
        method: 'POST',
        path: `${alarmPath}/actions/summarizeAlarmSuppressionHistory`,
        query: PAGE_FIELDS,
        body: ['dimensions', 'timeSuppressFromGreaterThanOrEqualTo', 'timeSuppressFromLessThan'],
      }
    case 'remove_alarm_suppression':
      return { method: 'POST', path: `${alarmPath}/actions/removeSuppression` }
  }
}

function selectFields(
  input: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    if (input[key] !== undefined) result[key] = input[key]
  }
  return result
}

function projectResponse(
  operation: OciMonitoringOperation,
  data: unknown,
  limit: number
): Record<string, unknown> {
  switch (operation) {
    case 'list_metrics':
      return { metrics: z.array(metricSchema).max(limit).parse(data) }
    case 'summarize_metrics_data':
      return { metricData: z.array(metricDataSchema).max(2000).parse(data) }
    case 'post_metric_data':
      return z
        .object({
          failedMetricsCount: z.number().int().nonnegative(),
          failedMetrics: z
            .array(failedMetricSchema)
            .max(50)
            .nullish()
            .transform((value) => value ?? []),
        })
        .parse(data)
    case 'list_alarms':
      return { alarms: z.array(alarmSummarySchema).max(limit).parse(data) }
    case 'list_alarms_status':
      return { alarmStatuses: z.array(alarmStatusSchema).max(limit).parse(data) }
    case 'get_alarm':
    case 'create_alarm':
    case 'update_alarm':
      return { alarm: alarmSchema.parse(data) }
    case 'get_alarm_history': {
      const history = z
        .object({
          alarmId: z.string(),
          isEnabled: z.boolean(),
          entries: z.array(historyEntrySchema).max(limit),
        })
        .parse(data)
      return { alarmId: history.alarmId, isEnabled: history.isEnabled, history: history.entries }
    }
    case 'retrieve_dimension_states': {
      const states = z
        .object({
          alarmId: z.string(),
          isEnabled: z.boolean(),
          isNotificationsPerMetricDimensionEnabled: z.boolean(),
          items: z.array(dimensionStateSchema).max(limit),
        })
        .parse(data)
      return {
        alarmId: states.alarmId,
        isEnabled: states.isEnabled,
        isNotificationsPerMetricDimensionEnabled: states.isNotificationsPerMetricDimensionEnabled,
        dimensionStates: states.items,
      }
    }
    case 'create_alarm_suppression':
    case 'get_alarm_suppression':
      return { alarmSuppression: alarmSuppressionSchema.parse(data) }
    case 'list_alarm_suppressions':
      return {
        alarmSuppressions: z
          .object({ items: z.array(alarmSuppressionSchema).max(limit) })
          .parse(data).items,
      }
    case 'summarize_alarm_suppression_history':
      return {
        suppressionHistory: z
          .object({ items: z.array(suppressionHistorySchema).max(limit) })
          .parse(data).items,
      }
    default:
      return {}
  }
}

export async function executeOciMonitoringOperation(
  client: OciClient,
  operation: OciMonitoringOperation,
  input: OciMonitoringInput,
  signal?: AbortSignal
): Promise<ToolResponse> {
  signal?.throwIfAborted()
  const spec = operationRequest(operation, input)
  const queryPairs: [string, string][] = []
  for (const [key, value] of Object.entries(selectFields(input, spec.query ?? []))) {
    if (value !== null) queryPairs.push([key, String(value)])
  }
  const body = selectFields(input, spec.body ?? [])
  if (operation === 'create_alarm_suppression' && 'alarmId' in input) {
    body.alarmSuppressionTarget = { targetType: 'ALARM', alarmId: input.alarmId }
  }
  if (operation === 'update_alarm' && !Object.keys(body).length) {
    throw new OciMonitoringInputError('Provide at least one alarm field to update')
  }
  const bytes = new TextEncoder().encode(JSON.stringify(body))
  if (bytes.byteLength > MAX_REQUEST_BYTES) {
    throw new OciMonitoringInputError('Monitoring request exceeds the 1 MiB Sim request limit')
  }
  if (operation === 'post_metric_data' && 'metricData' in input) {
    const now = Date.now()
    for (const metric of input.metricData) {
      for (const point of metric.datapoints) {
        const time = Date.parse(point.timestamp)
        if (time <= now - 2 * 60 * 60 * 1000 || time >= now + 10 * 60 * 1000) {
          throw new OciMonitoringInputError(
            'Metric timestamps must be less than two hours old and less than ten minutes in the future'
          )
        }
      }
    }
  }
  const endpoint = await client.prepareStaticEndpoint(
    operation === 'post_metric_data' ? INGESTION_ENDPOINT : OCI_MONITORING_ENDPOINT
  )
  const headers: Record<string, string> = {}
  if ('ifMatch' in input && input.ifMatch) headers['if-match'] = input.ifMatch
  const base = {
    endpoint,
    encodedPath: `/20180401${spec.path}`,
    queryPairs,
    headers,
    responseHeaders: ['opc-next-page', 'etag'],
    timeoutMs: TIMEOUT_MS,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    signal,
  }
  let request: OciRequest
  if (spec.method === 'GET') {
    request = { ...base, method: 'GET', retry: { kind: 'safe', maxAttempts: 3 } }
  } else if (spec.method === 'DELETE') {
    request = { ...base, method: 'DELETE' }
  } else {
    request = {
      ...base,
      method: spec.method,
      body: bytes,
      contentType: 'application/json',
      ...(spec.tokenized && 'opcRetryToken' in input && input.opcRetryToken
        ? { retry: { kind: 'tokenized' as const, retryToken: input.opcRetryToken, maxAttempts: 3 } }
        : {}),
    }
  }
  const response = await client.request(request)
  const emptyResponse = [
    'delete_alarm',
    'delete_alarm_suppression',
    'remove_alarm_suppression',
  ].includes(operation)
  let output: Record<string, unknown>
  try {
    output = emptyResponse
      ? {}
      : projectResponse(
          operation,
          JSON.parse(new TextDecoder().decode(response.body)),
          'limit' in input ? input.limit : 100
        )
  } catch {
    throw new Error('OCI Monitoring returned an unexpected or oversized response')
  }
  if (operation === 'summarize_metrics_data' && 'maxStreams' in input) {
    const series = output.metricData as OciMetricData[]
    const points = series.reduce((count, metric) => count + metric.aggregatedDatapoints.length, 0)
    if (series.length > input.maxStreams || points > input.maxDatapoints) {
      throw new OciMonitoringInputError(
        'Metric results exceed the selected stream or datapoint budget; narrow the MQL/time range or increase the output budget'
      )
    }
  }
  output.opcRequestId = response.opcRequestId ?? null
  if (spec.query?.includes('page')) output.nextPage = response.headers['opc-next-page'] ?? null
  if (
    [
      'get_alarm',
      'create_alarm',
      'update_alarm',
      'get_alarm_suppression',
      'create_alarm_suppression',
    ].includes(operation)
  ) {
    output.etag = response.headers.etag ?? null
  }
  if (operation === 'post_metric_data' && Number(output.failedMetricsCount) > 0) {
    return {
      success: false,
      retryable: false,
      error: 'OCI rejected one or more metric records; inspect failedMetrics before resubmitting',
      output,
    }
  }
  return { success: true, output }
}
