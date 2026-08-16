/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEventTool } from '@/tools/datadog/create_event'
import { createMonitorTool } from '@/tools/datadog/create_monitor'
import { getIncidentTool } from '@/tools/datadog/get_incident'
import { listDowntimesTool } from '@/tools/datadog/list_downtimes'
import { listIncidentsTool } from '@/tools/datadog/list_incidents'
import { queryLogsTool } from '@/tools/datadog/query_logs'
import { queryTimeseriesTool } from '@/tools/datadog/query_timeseries'
import { sendLogsTool } from '@/tools/datadog/send_logs'
import { submitMetricsTool } from '@/tools/datadog/submit_metrics'
import { updateIncidentTool } from '@/tools/datadog/update_incident'
import { updateSloTool } from '@/tools/datadog/update_slo'
import { buildSloPayload, datadogErrorMessage, mergeSloUpdatePayload } from '@/tools/datadog/utils'

const auth = { apiKey: 'key', applicationKey: 'app-key' } as const

function jsonResponse(body: unknown, init?: { status?: number; statusText?: string }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    statusText: init?.statusText ?? 'OK',
    headers: { 'Content-Type': 'application/json' },
  })
}

function callBody<TParams>(
  tool: { request: { body?: (params: TParams) => unknown } },
  params: TParams
): any {
  return tool.request.body?.(params)
}

function callUrl<TParams>(tool: { request: { url: unknown } }, params: TParams): string {
  const url = tool.request.url
  return typeof url === 'function' ? url(params) : (url as string)
}

describe('submit_metrics metric intake types', () => {
  /**
   * Datadog `MetricIntakeType` is 0 unspecified, 1 count, 2 rate, 3 gauge. Swapping
   * these silently changes how Datadog aggregates the series.
   */
  it.each([
    ['count', 1],
    ['rate', 2],
    ['gauge', 3],
  ])('encodes %s as %i', (type, code) => {
    const body = callBody(submitMetricsTool, {
      ...auth,
      series: JSON.stringify([{ metric: 'm', type, points: [{ timestamp: 1, value: 2 }] }]),
    } as any)
    expect(body.series[0].type).toBe(code)
  })

  it('omits type when the caller did not supply one', () => {
    const body = callBody(submitMetricsTool, {
      ...auth,
      series: JSON.stringify([{ metric: 'm', points: [{ timestamp: 1, value: 2 }] }]),
    } as any)
    expect(body.series[0]).not.toHaveProperty('type')
  })

  it('does not invent a resources entry', () => {
    const body = callBody(submitMetricsTool, {
      ...auth,
      series: JSON.stringify([{ metric: 'm', points: [{ timestamp: 1, value: 2 }] }]),
    } as any)
    expect(body.series[0]).not.toHaveProperty('resources')
  })

  it('forwards interval, which Datadog requires for count and rate metrics', () => {
    const body = callBody(submitMetricsTool, {
      ...auth,
      series: JSON.stringify([
        { metric: 'm', type: 'count', interval: 20, points: [{ timestamp: 1, value: 2 }] },
      ]),
    } as any)
    expect(body.series[0].interval).toBe(20)
  })
})

describe('SLO payloads', () => {
  it('rejects blank thresholds instead of sending an empty array', () => {
    expect(() =>
      buildSloPayload({ ...auth, name: 'n', type: 'metric', thresholds: '' } as any)
    ).toThrow(/thresholds must be a non-empty JSON array/)
  })

  it('rejects a non-numeric monitor id instead of sending null', () => {
    expect(() =>
      buildSloPayload({
        ...auth,
        name: 'n',
        type: 'monitor',
        thresholds: '[{"timeframe":"30d","target":99.9}]',
        monitorIds: '123,abc',
      } as any)
    ).toThrow(/monitorIds must be a comma-separated list of whole numbers/)
  })

  /**
   * `PUT /api/v1/slo/{slo_id}` is a full replacement, so every stored field the user
   * did not edit has to be replayed or Datadog erases it.
   */
  it('preserves stored fields the caller left blank', () => {
    const stored = {
      id: 'slo-1',
      created_at: 1,
      modified_at: 2,
      creator: { email: 'a@b.c' },
      monitor_tags: ['env:prod'],
      name: 'Old name',
      type: 'monitor',
      thresholds: [{ timeframe: '30d', target: 99.9 }],
      description: 'keep me',
      tags: ['team:core'],
      monitor_ids: [123],
      groups: ['env:prod'],
      target_threshold: 99.9,
      timeframe: '30d',
    }

    const body = mergeSloUpdatePayload(stored, { ...auth, sloId: 'slo-1', name: 'New name' } as any)

    expect(body.name).toBe('New name')
    expect(body.description).toBe('keep me')
    expect(body.tags).toEqual(['team:core'])
    expect(body.monitor_ids).toEqual([123])
    expect(body.groups).toEqual(['env:prod'])
    expect(body.thresholds).toEqual([{ timeframe: '30d', target: 99.9 }])
    expect(body.target_threshold).toBe(99.9)
    expect(body.timeframe).toBe('30d')
  })

  it('strips fields Datadog computes and rejects on update', () => {
    const body = mergeSloUpdatePayload(
      { id: 'slo-1', created_at: 1, modified_at: 2, creator: {}, monitor_tags: [], name: 'n' },
      { ...auth, sloId: 'slo-1' } as any
    )
    for (const field of ['id', 'created_at', 'modified_at', 'creator', 'monitor_tags']) {
      expect(body).not.toHaveProperty(field)
    }
  })
})

describe('update_slo read-modify-write', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('reads the stored SLO before replacing it', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({ data: { id: 'slo-1', name: 'Old', type: 'metric', description: 'keep' } })
      )
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'slo-1', name: 'New' }] }))

    const result = await updateSloTool.directExecution!(
      { ...auth, sloId: 'slo-1', name: 'New' } as any,
      undefined
    )

    expect(result.success).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET')

    const putBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(putBody.name).toBe('New')
    expect(putBody.description).toBe('keep')
  })

  it('does not write when the stored SLO cannot be read', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ errors: ['SLO not found'] }, { status: 404 }))

    const result = await updateSloTool.directExecution!(
      { ...auth, sloId: 'missing', name: 'New' } as any,
      undefined
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('SLO not found')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('datadogErrorMessage', () => {
  it('reads v1 string errors', async () => {
    await expect(
      datadogErrorMessage(jsonResponse({ errors: ['bad query'] }, { status: 400 }))
    ).resolves.toBe('bad query')
  })

  it('reads v2 JSON:API error objects', async () => {
    await expect(
      datadogErrorMessage(jsonResponse({ errors: [{ detail: 'forbidden' }] }, { status: 403 }))
    ).resolves.toBe('forbidden')
  })

  /** The SLO delete conflict returns errors as a map of resource id to reason. */
  it('reads dictionary-shaped errors', async () => {
    await expect(
      datadogErrorMessage(
        jsonResponse({ errors: { 'slo-1': 'still referenced by a dashboard' } }, { status: 409 })
      )
    ).resolves.toBe('still referenced by a dashboard')
  })

  it('falls back to the status line when no message is present', async () => {
    await expect(
      datadogErrorMessage(jsonResponse({}, { status: 500, statusText: 'Server Error' }))
    ).resolves.toBe('HTTP 500: Server Error')
  })
})

describe('send_logs', () => {
  /** Datadog treats unrecognized keys as the log's structured attributes. */
  it('preserves custom attributes', () => {
    const body = callBody(sendLogsTool, {
      ...auth,
      logs: JSON.stringify([{ message: 'boom', status: 'error', orderId: 42 }]),
    } as any)
    expect(body[0].status).toBe('error')
    expect(body[0].orderId).toBe(42)
  })

  it('does not pad absent optional fields with empty strings', () => {
    const body = callBody(sendLogsTool, {
      ...auth,
      logs: JSON.stringify([{ message: 'boom' }]),
    } as any)
    expect(body[0]).not.toHaveProperty('hostname')
    expect(body[0]).not.toHaveProperty('service')
    expect(body[0]).not.toHaveProperty('ddtags')
  })
})

describe('incident include parameter', () => {
  /** The spec enum is exact, so a space from a comma-separated input 400s. */
  it('trims spaces in get_incident', () => {
    const url = callUrl(getIncidentTool, {
      ...auth,
      incidentId: 'abc',
      include: 'users, attachments',
    } as any)
    expect(url).toContain('include=users%2Cattachments')
    expect(url).not.toContain('%20')
  })

  it('trims spaces in list_incidents', () => {
    const url = callUrl(listIncidentsTool, { ...auth, include: 'users, attachments' } as any)
    expect(url).toContain('include=users%2Cattachments')
    expect(url).not.toContain('%20')
  })
})

describe('update_incident blank handling', () => {
  /** A blank input must not blank the stored incident under a partial update. */
  it('omits empty strings rather than overwriting stored values', () => {
    const body = callBody(updateIncidentTool, {
      ...auth,
      incidentId: 'abc',
      title: '',
      customerImpactScope: '',
      detected: '',
    } as any)
    expect(body.data.attributes).not.toHaveProperty('title')
    expect(body.data.attributes).not.toHaveProperty('customer_impact_scope')
    expect(body.data.attributes).not.toHaveProperty('detected')
  })

  it('still sends supplied values', () => {
    const body = callBody(updateIncidentTool, {
      ...auth,
      incidentId: 'abc',
      title: 'Real title',
    } as any)
    expect(body.data.id).toBe('abc')
    expect(body.data.type).toBe('incidents')
    expect(body.data.attributes.title).toBe('Real title')
  })
})

describe('create_monitor options', () => {
  /** Silently dropping malformed options created monitors with no thresholds. */
  it('fails loudly on malformed options JSON', () => {
    expect(() =>
      callBody(createMonitorTool, {
        ...auth,
        name: 'n',
        type: 'metric alert',
        query: 'q',
        options: '{not json',
      } as any)
    ).toThrow(/options parameter must be valid JSON/)
  })
})

describe('query_timeseries', () => {
  /** Datadog reports query failures with a 200 and a non-ok status. */
  it('surfaces a non-ok status as a failure', async () => {
    const result = await queryTimeseriesTool.transformResponse!(
      jsonResponse({ status: 'error', error: 'invalid query', series: [] })
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('invalid query')
  })

  it('passes through a successful query', async () => {
    const result = await queryTimeseriesTool.transformResponse!(
      jsonResponse({ status: 'ok', series: [{ metric: 'm', tag_set: [], pointlist: [[1000, 5]] }] })
    )
    expect(result.success).toBe(true)
    expect(result.output.series[0].points[0]).toEqual({ timestamp: 1, value: 5 })
  })
})

describe('pagination wiring', () => {
  it('sends downtime page params', () => {
    const url = callUrl(listDowntimesTool, { ...auth, limit: 50, offset: 100 } as any)
    expect(url).toContain('page%5Blimit%5D=50')
    expect(url).toContain('page%5Boffset%5D=100')
  })

  it('feeds a log search cursor back into the request', () => {
    const body = callBody(queryLogsTool, {
      ...auth,
      query: '*',
      from: 'now-1h',
      to: 'now',
      cursor: 'abc123',
    } as any)
    expect(body.page.cursor).toBe('abc123')
  })
})

describe('registry surface', () => {
  /** `/api/v1/monitor/{id}/mute` is absent from the published v1 spec. */
  it('does not ship a mute monitor tool', async () => {
    const datadogTools = await import('@/tools/datadog/index')
    expect(Object.keys(datadogTools)).not.toContain('datadogMuteMonitorTool')
  })

  it('keeps create_event on api-key-only auth', () => {
    expect(createEventTool.params.applicationKey).toBeUndefined()
  })
})
