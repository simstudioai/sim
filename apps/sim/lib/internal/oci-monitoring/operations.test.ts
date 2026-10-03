/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OciClient, OciRequest } from '@/lib/internal/oci/client.server'
import { OciClientError } from '@/lib/internal/oci/errors'
import {
  type OciMonitoringOperation,
  ociMonitoringInputSchemas,
} from '@/lib/internal/oci-monitoring/input'
import { executeOciMonitoringOperation } from '@/lib/internal/oci-monitoring/operations'

const alarm = {
  id: 'alarm/one',
  displayName: 'CPU',
  compartmentId: 'compartment',
  metricCompartmentId: 'metrics-compartment',
  namespace: 'oci_computeagent',
  query: 'CpuUtilization[1m].mean() > 80',
  severity: 'WARNING',
  destinations: ['topic'],
  isEnabled: false,
  lifecycleState: 'ACTIVE',
}
const suppression = {
  id: 'suppression/one',
  compartmentId: 'compartment',
  alarmSuppressionTarget: { targetType: 'ALARM', alarmId: alarm.id },
  level: 'ALARM',
  displayName: 'Maintenance',
  timeSuppressFrom: '2026-09-05T12:00:00Z',
  timeSuppressUntil: '2026-09-05T13:00:00Z',
  lifecycleState: 'ACTIVE',
}
const point = { timestamp: '2026-09-05T12:00:00Z', value: 0 }
const metric = {
  compartmentId: 'compartment',
  namespace: 'my_app',
  name: 'Requests',
  dimensions: { resourceId: 'resource' },
  datapoints: [point],
}
const series = { ...metric, aggregatedDatapoints: [point] }
const alarmInput = {
  displayName: alarm.displayName,
  compartmentId: alarm.compartmentId,
  metricCompartmentId: alarm.metricCompartmentId,
  namespace: alarm.namespace,
  query: alarm.query,
  severity: alarm.severity,
  destinations: alarm.destinations,
  isEnabled: false,
}
const cases: {
  operation: OciMonitoringOperation
  input: Record<string, unknown>
  method: string
  path: string
  response: unknown
  output: string | null
}[] = [
  {
    operation: 'list_metrics',
    input: { compartmentId: 'compartment' },
    method: 'POST',
    path: '/metrics/actions/listMetrics',
    response: [],
    output: 'metrics',
  },
  {
    operation: 'summarize_metrics_data',
    input: {
      compartmentId: 'compartment',
      namespace: 'my_app',
      query: 'Requests[1m].mean()',
    },
    method: 'POST',
    path: '/metrics/actions/summarizeMetricsData',
    response: [series],
    output: 'metricData',
  },
  {
    operation: 'post_metric_data',
    input: { metricData: [metric] },
    method: 'POST',
    path: '/metrics',
    response: { failedMetricsCount: 0, failedMetrics: [] },
    output: 'failedMetrics',
  },
  {
    operation: 'list_alarms',
    input: { compartmentId: 'compartment' },
    method: 'GET',
    path: '/alarms',
    response: [alarm],
    output: 'alarms',
  },
  {
    operation: 'list_alarms_status',
    input: { compartmentId: 'compartment' },
    method: 'GET',
    path: '/alarms/status',
    response: [{ id: alarm.id, displayName: 'CPU', severity: 'WARNING', status: 'OK' }],
    output: 'alarmStatuses',
  },
  {
    operation: 'get_alarm',
    input: { alarmId: alarm.id },
    method: 'GET',
    path: '/alarms/alarm%2Fone',
    response: alarm,
    output: 'alarm',
  },
  {
    operation: 'get_alarm_history',
    input: { alarmId: alarm.id },
    method: 'GET',
    path: '/alarms/alarm%2Fone/history',
    response: { alarmId: alarm.id, isEnabled: false, entries: [point] },
    output: 'history',
  },
  {
    operation: 'retrieve_dimension_states',
    input: { alarmId: alarm.id },
    method: 'POST',
    path: '/alarms/alarm%2Fone/actions/retrieveDimensionStates',
    response: {
      alarmId: alarm.id,
      isEnabled: false,
      isNotificationsPerMetricDimensionEnabled: false,
      items: [{ dimensions: metric.dimensions, timestamp: point.timestamp, status: 'OK' }],
    },
    output: 'dimensionStates',
  },
  {
    operation: 'create_alarm',
    input: alarmInput,
    method: 'POST',
    path: '/alarms',
    response: alarm,
    output: 'alarm',
  },
  {
    operation: 'update_alarm',
    input: { alarmId: alarm.id, isEnabled: false },
    method: 'PUT',
    path: '/alarms/alarm%2Fone',
    response: alarm,
    output: 'alarm',
  },
  {
    operation: 'delete_alarm',
    input: { alarmId: alarm.id },
    method: 'DELETE',
    path: '/alarms/alarm%2Fone',
    response: undefined,
    output: null,
  },
  {
    operation: 'create_alarm_suppression',
    input: {
      alarmId: alarm.id,
      displayName: suppression.displayName,
      timeSuppressFrom: suppression.timeSuppressFrom,
      timeSuppressUntil: suppression.timeSuppressUntil,
    },
    method: 'POST',
    path: '/alarmSuppressions',
    response: suppression,
    output: 'alarmSuppression',
  },
  {
    operation: 'list_alarm_suppressions',
    input: { alarmId: alarm.id },
    method: 'GET',
    path: '/alarmSuppressions',
    response: { items: [suppression] },
    output: 'alarmSuppressions',
  },
  {
    operation: 'get_alarm_suppression',
    input: { alarmSuppressionId: suppression.id },
    method: 'GET',
    path: '/alarmSuppressions/suppression%2Fone',
    response: suppression,
    output: 'alarmSuppression',
  },
  {
    operation: 'delete_alarm_suppression',
    input: { alarmSuppressionId: suppression.id },
    method: 'DELETE',
    path: '/alarmSuppressions/suppression%2Fone',
    response: undefined,
    output: null,
  },
  {
    operation: 'summarize_alarm_suppression_history',
    input: { alarmId: alarm.id },
    method: 'POST',
    path: '/alarms/alarm%2Fone/actions/summarizeAlarmSuppressionHistory',
    response: {
      items: [
        {
          suppressionId: suppression.id,
          alarmSuppressionTarget: suppression.alarmSuppressionTarget,
          level: 'ALARM',
          displayName: 'Maintenance',
          timeEffectiveFrom: point.timestamp,
        },
      ],
    },
    output: 'suppressionHistory',
  },
  {
    operation: 'remove_alarm_suppression',
    input: { alarmId: alarm.id },
    method: 'POST',
    path: '/alarms/alarm%2Fone/actions/removeSuppression',
    response: undefined,
    output: null,
  },
]

const request = vi.fn()
const prepareStaticEndpoint = vi.fn()
const client: OciClient = {
  request,
  prepareStaticEndpoint,
  prepareDiscoveredEndpoint: vi.fn(),
}

function reply(data: unknown, headers: Record<string, string> = {}) {
  request.mockResolvedValue({
    status: data === undefined ? 204 : 200,
    headers,
    opcRequestId: 'oracle-request',
    body: new TextEncoder().encode(data === undefined ? '' : JSON.stringify(data)),
  })
}

function execute(
  operation: OciMonitoringOperation,
  input: Record<string, unknown>,
  signal?: AbortSignal
) {
  return executeOciMonitoringOperation(
    client,
    operation,
    ociMonitoringInputSchemas[operation].parse({ oauthCredential: 'credential', ...input }),
    signal
  )
}

function sent(): OciRequest {
  return request.mock.calls[0][0]
}

function body() {
  return JSON.parse(new TextDecoder().decode(sent().body))
}

describe('OCI Monitoring operations', () => {
  afterEach(() => vi.restoreAllMocks())

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(point.timestamp))
    prepareStaticEndpoint.mockResolvedValue({ hostname: 'prepared-by-foundation' })
  })

  it.each(cases)('uses the documented contract for $operation', async (testCase) => {
    reply(testCase.response, { etag: 'version' })
    const controller = new AbortController()

    const result = await execute(testCase.operation, testCase.input, controller.signal)

    expect(result.success).toBe(true)
    expect(result.output.opcRequestId).toBe('oracle-request')
    if (testCase.output) expect(result.output).toHaveProperty(testCase.output)
    else expect(result.output).toEqual({ opcRequestId: 'oracle-request' })
    expect(request).toHaveBeenCalledTimes(1)
    expect(sent()).toMatchObject({
      method: testCase.method,
      encodedPath: `/20180401${testCase.path}`,
      maxResponseBytes: 8 * 1024 * 1024,
      timeoutMs: 60_000,
      signal: controller.signal,
      responseHeaders: ['opc-next-page', 'etag'],
    })
    expect(prepareStaticEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceId: 'oci_monitoring',
        serviceName:
          testCase.operation === 'post_metric_data' ? 'telemetry-ingestion' : 'telemetry',
      })
    )
    expect(sent().retry).toEqual(
      testCase.method === 'GET' ? { kind: 'safe', maxAttempts: 3 } : undefined
    )
  })

  it.each([
    ['list_metrics', [], { compartmentId: 'compartment' }],
    ['list_alarms', [], { compartmentId: 'compartment' }],
    [
      'get_alarm_history',
      { alarmId: alarm.id, isEnabled: false, entries: [] },
      { alarmId: alarm.id },
    ],
    [
      'retrieve_dimension_states',
      {
        alarmId: alarm.id,
        isEnabled: false,
        isNotificationsPerMetricDimensionEnabled: false,
        items: [],
      },
      { alarmId: alarm.id },
    ],
    ['list_alarm_suppressions', { items: [] }, { alarmId: alarm.id }],
    ['summarize_alarm_suppression_history', { items: [] }, { alarmId: alarm.id }],
  ] as const)('preserves an empty page cursor for %s', async (operation, response, input) => {
    reply(response, { 'opc-next-page': 'next::+=/' })

    const result = await execute(operation, { ...input, page: 'previous::+=/' })

    expect(result.output.nextPage).toBe('next::+=/')
    expect(sent().queryPairs).toEqual(
      expect.arrayContaining([
        ['page', 'previous::+=/'],
        ['limit', '100'],
      ])
    )
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('keeps MQL exact and omits optional query timestamps to preserve Oracle defaults', async () => {
    reply([])
    const query = 'Requests[5m]{resourceId = "a"}.groupBy(resourceId).percentile(0.9)'
    await execute('summarize_metrics_data', {
      compartmentId: 'compartment',
      compartmentIdInSubtree: false,
      namespace: 'my_app',
      query,
      resolution: '1m',
    })

    expect(body()).toEqual({ namespace: 'my_app', query, resolution: '1m' })
    expect(sent().queryPairs).toContainEqual(['compartmentIdInSubtree', 'false'])
  })

  it('puts metric discovery filters in the body and preserves a null resource group', async () => {
    reply([])
    await execute('list_metrics', {
      compartmentId: 'compartment',
      compartmentIdInSubtree: false,
      namespace: 'my_app',
      resourceGroup: null,
      dimensionFilters: { resourceId: 'resource' },
      groupBy: ['namespace'],
      sortBy: 'NAMESPACE',
      sortOrder: 'ASC',
      limit: 20,
    })
    expect(body()).toEqual({
      namespace: 'my_app',
      resourceGroup: null,
      dimensionFilters: { resourceId: 'resource' },
      groupBy: ['namespace'],
      sortBy: 'NAMESPACE',
      sortOrder: 'ASC',
    })
    expect(sent().queryPairs).toEqual([
      ['compartmentId', 'compartment'],
      ['compartmentIdInSubtree', 'false'],
      ['limit', '20'],
    ])
  })

  it('uses the exact alarm-history wire key and leaves timestamp boundaries intact', async () => {
    reply({ alarmId: alarm.id, isEnabled: false, entries: [] })
    await execute('get_alarm_history', {
      alarmId: alarm.id,
      alarmHistorytype: 'STATE_TRANSITION_HISTORY',
      timestampGreaterThanOrEqualTo: '2026-09-05T01:00:00-07:00',
      timestampLessThan: '2026-09-05T02:00:00-07:00',
    })
    expect(sent().queryPairs).toEqual(
      expect.arrayContaining([
        ['alarmHistorytype', 'STATE_TRANSITION_HISTORY'],
        ['timestampGreaterThanOrEqualTo', '2026-09-05T01:00:00-07:00'],
        ['timestampLessThan', '2026-09-05T02:00:00-07:00'],
      ])
    )
  })

  it.each(['delete_alarm', 'delete_alarm_suppression', 'remove_alarm_suppression'] as const)(
    'forwards optimistic concurrency without retrying %s',
    async (operation) => {
      reply(undefined)
      await execute(operation, {
        alarmId: alarm.id,
        alarmSuppressionId: suppression.id,
        ifMatch: 'version',
      })
      expect(sent().headers).toEqual({ 'if-match': 'version' })
      expect(sent().retry).toBeUndefined()
    }
  )

  it.each([
    { maxStreams: 1, maxDatapoints: 10 },
    { maxStreams: 10, maxDatapoints: 1 },
  ])('fails explicitly when a query exceeds its selected output budget', async (budget) => {
    reply([series, series])
    await expect(
      execute('summarize_metrics_data', {
        compartmentId: 'compartment',
        namespace: 'my_app',
        query: 'Requests[1m].mean()',
        ...budget,
      })
    ).rejects.toThrow('narrow the MQL/time range')
  })

  it('preserves explicit false and empty update collections without sending omitted fields', async () => {
    reply(alarm, { etag: 'new-version' })
    const result = await execute('update_alarm', {
      alarmId: alarm.id,
      isEnabled: false,
      freeformTags: {},
      overrides: [],
      ifMatch: 'old-version',
    })

    expect(body()).toEqual({ isEnabled: false, freeformTags: {}, overrides: [] })
    expect(sent().headers).toEqual({ 'if-match': 'old-version' })
    expect(result.output.etag).toBe('new-version')
  })

  it('rejects an empty update before contacting Oracle', async () => {
    await expect(execute('update_alarm', { alarmId: alarm.id })).rejects.toThrow('at least one')
    expect(prepareStaticEndpoint).not.toHaveBeenCalled()
  })

  it('accepts Oracle’s documented two-override alarm configuration', async () => {
    const overrides = [
      { query: 'CpuUtilization[1m].mean() > 95', ruleName: '95', severity: 'CRITICAL' },
      { query: 'CpuUtilization[1m].mean() > 90', ruleName: '90', severity: 'WARNING' },
    ]
    reply({ ...alarm, overrides })
    await execute('update_alarm', { alarmId: alarm.id, overrides })
    expect(body()).toEqual({ overrides })
  })

  it.each(['create_alarm', 'create_alarm_suppression'] as const)(
    'enables tokenized retries only with a stable token for %s',
    async (operation) => {
      const testCase = cases.find((entry) => entry.operation === operation)!
      reply(testCase.response)
      await execute(operation, { ...testCase.input, opcRetryToken: 'stable-token' })

      expect(sent().retry).toEqual({
        kind: 'tokenized',
        maxAttempts: 3,
        retryToken: 'stable-token',
      })
    }
  )

  it('builds the suppression target and preserves dimension values', async () => {
    reply(suppression)
    await execute('create_alarm_suppression', {
      alarmId: alarm.id,
      displayName: 'Maintenance',
      level: 'DIMENSION',
      dimensions: { resourceId: 'instance' },
      timeSuppressFrom: suppression.timeSuppressFrom,
      timeSuppressUntil: suppression.timeSuppressUntil,
    })
    expect(body()).toMatchObject({
      alarmSuppressionTarget: { targetType: 'ALARM', alarmId: alarm.id },
      dimensions: { resourceId: 'instance' },
      level: 'DIMENSION',
    })
    expect(body()).not.toHaveProperty('alarmId')
  })

  it('preserves failed records and zero datapoints without inventing accepted counts or resending', async () => {
    const failed = { message: 'invalid metric', metricData: metric }
    reply({ failedMetricsCount: 1, failedMetrics: [failed] })
    const result = await execute('post_metric_data', { metricData: [metric] })

    expect(result).toMatchObject({
      success: false,
      retryable: false,
      output: { failedMetricsCount: 1, failedMetrics: [failed] },
    })
    expect(result.output).not.toHaveProperty('acceptedDatapoints')
    expect(body().metricData[0].datapoints[0].value).toBe(0)
    expect(request).toHaveBeenCalledTimes(1)
    expect(sent().retry).toBeUndefined()
  })

  it.each([-2 * 60 * 60 * 1000, 10 * 60 * 1000])(
    'rejects ingestion timestamps on the excluded boundary %i',
    async (offset) => {
      await expect(
        execute('post_metric_data', {
          metricData: [
            {
              ...metric,
              datapoints: [
                {
                  timestamp: new Date(Date.now() + offset).toISOString(),
                  value: 0,
                },
              ],
            },
          ],
        })
      ).rejects.toThrow('less than two hours')
      expect(request).not.toHaveBeenCalled()
    }
  )

  it('enforces serialized request bytes before endpoint preparation', async () => {
    await expect(
      execute('post_metric_data', {
        metricData: [{ ...metric, datapoints: Array.from({ length: 25000 }, () => point) }],
      })
    ).rejects.toThrow('1 MiB')
    expect(prepareStaticEndpoint).not.toHaveBeenCalled()
  })

  it('does not catch and resend an ingestion transport failure', async () => {
    const error = new OciClientError('request_failed', { status: 503 })
    request.mockRejectedValueOnce(error)
    await expect(execute('post_metric_data', { metricData: [metric] })).rejects.toBe(error)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does not replace the foundation response byte cap with truncation', async () => {
    const error = new OciClientError('response_too_large')
    request.mockRejectedValueOnce(error)
    await expect(execute('list_metrics', { compartmentId: 'compartment' })).rejects.toBe(error)
    expect(sent().maxResponseBytes).toBe(8 * 1024 * 1024)
  })

  it('rejects undocumented response envelopes', async () => {
    reply({ alarms: [alarm] })
    await expect(
      execute('list_alarms', {
        compartmentId: 'compartment',
      })
    ).rejects.toThrow('unexpected')
  })

  it('does not advertise full alarm fields in a list response', async () => {
    reply([{ ...alarm, body: 'detail-only', timeCreated: point.timestamp }])
    const result = await execute('list_alarms', { compartmentId: 'compartment' })
    expect(result.output.alarms).toEqual([alarm])
  })

  it('preserves cancellation before any provider work', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      execute(
        'get_alarm',
        {
          alarmId: alarm.id,
        },
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(prepareStaticEndpoint).not.toHaveBeenCalled()
  })
})

describe('OCI Monitoring input policy', () => {
  it('does not apply the creation-only dimension character cap to state or history queries', () => {
    const dimensions = { resourceId: 'x'.repeat(4100) }
    expect(
      ociMonitoringInputSchemas.retrieve_dimension_states.parse({
        oauthCredential: 'credential',
        alarmId: alarm.id,
        dimensionFilters: dimensions,
      }).dimensionFilters
    ).toEqual(dimensions)
    expect(
      ociMonitoringInputSchemas.summarize_alarm_suppression_history.parse({
        oauthCredential: 'credential',
        alarmId: alarm.id,
        dimensions,
      }).dimensions
    ).toEqual(dimensions)
  })

  it('rejects future suppression history filters', () => {
    expect(
      ociMonitoringInputSchemas.summarize_alarm_suppression_history.safeParse({
        oauthCredential: 'credential',
        alarmId: alarm.id,
        timeSuppressFromLessThan: new Date(Date.now() + 60_000).toISOString(),
      }).success
    ).toBe(false)
  })

  it('uses the documented removal operation instead of accepting a null suppression update', () => {
    expect(
      ociMonitoringInputSchemas.update_alarm.safeParse({
        oauthCredential: 'credential',
        alarmId: alarm.id,
        suppression: null,
      }).success
    ).toBe(false)
  })

  it.each([
    { namespace: 'oci_custom' },
    { namespace: 'oracle_custom' },
    { dimensions: {} },
    { dimensions: { 'invalid key': 'value' } },
    { dimensions: { key: '' } },
    { dimensions: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`key${i}`, 'v'])) },
  ])('rejects invalid custom metric identity %j', (patch) => {
    expect(
      ociMonitoringInputSchemas.post_metric_data.safeParse({
        oauthCredential: 'credential',
        metricData: [{ ...metric, ...patch }],
      }).success
    ).toBe(false)
  })

  it('keeps discovery dimensions separate from ingestion policy and accepts resolved JSON', () => {
    expect(
      ociMonitoringInputSchemas.list_metrics.parse({
        oauthCredential: 'credential',
        compartmentId: 'compartment',
        dimensionFilters: '{"service label":"値"}',
        groupBy: '["namespace"]',
      })
    ).toMatchObject({ dimensionFilters: { 'service label': '値' }, groupBy: ['namespace'] })
  })

  it('bounds ingestion records and query budgets', () => {
    expect(
      ociMonitoringInputSchemas.post_metric_data.safeParse({
        oauthCredential: 'credential',
        metricData: Array.from({ length: 51 }, () => metric),
      }).success
    ).toBe(false)
    expect(
      ociMonitoringInputSchemas.summarize_metrics_data.safeParse({
        oauthCredential: 'credential',
        compartmentId: 'compartment',
        namespace: 'my_app',
        query: 'Requests[1m].mean()',
        maxStreams: 2001,
      }).success
    ).toBe(false)
  })

  it('validates RFC3339 query order without parsing or rewriting MQL', () => {
    const input = {
      oauthCredential: 'credential',
      compartmentId: 'compartment',
      namespace: 'my_app',
      query: 'Requests[1m].mean()',
    }
    expect(
      ociMonitoringInputSchemas.summarize_metrics_data.safeParse({
        ...input,
        startTime: point.timestamp,
        endTime: point.timestamp,
      }).success
    ).toBe(false)
    expect(
      ociMonitoringInputSchemas.summarize_metrics_data.safeParse({
        ...input,
        startTime: '1757073600',
      }).success
    ).toBe(false)
  })

  it('requires dimension suppression targets and an increasing suppression window', () => {
    const input = {
      oauthCredential: 'credential',
      alarmId: alarm.id,
      displayName: 'Maintenance',
      timeSuppressFrom: suppression.timeSuppressFrom,
      timeSuppressUntil: suppression.timeSuppressUntil,
    }
    expect(
      ociMonitoringInputSchemas.create_alarm_suppression.safeParse({
        ...input,
        level: 'DIMENSION',
      }).success
    ).toBe(false)
    expect(
      ociMonitoringInputSchemas.create_alarm_suppression.safeParse({
        ...input,
        timeSuppressUntil: input.timeSuppressFrom,
      }).success
    ).toBe(false)
  })
})
