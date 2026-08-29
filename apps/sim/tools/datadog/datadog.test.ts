/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeUpdateSloOperation } from '@/lib/internal/datadog/operations/update-slo'
import { cancelDowntimeTool } from '@/tools/datadog/cancel_downtime'
import { createDowntimeTool } from '@/tools/datadog/create_downtime'
import { createEventTool } from '@/tools/datadog/create_event'
import { createMonitorTool } from '@/tools/datadog/create_monitor'
import { getIncidentTool } from '@/tools/datadog/get_incident'
import { getMonitorTool } from '@/tools/datadog/get_monitor'
import { listDashboardsTool } from '@/tools/datadog/list_dashboards'
import { listDowntimesTool } from '@/tools/datadog/list_downtimes'
import { listIncidentsTool } from '@/tools/datadog/list_incidents'
import { listMonitorsTool } from '@/tools/datadog/list_monitors'
import { muteMonitorTool } from '@/tools/datadog/mute_monitor'
import { queryLogsTool } from '@/tools/datadog/query_logs'
import { queryTimeseriesTool } from '@/tools/datadog/query_timeseries'
import { sendLogsTool } from '@/tools/datadog/send_logs'
import { submitMetricsTool } from '@/tools/datadog/submit_metrics'
import { DATADOG_SITES } from '@/tools/datadog/types'
import { unmuteMonitorTool } from '@/tools/datadog/unmute_monitor'
import { updateIncidentTool } from '@/tools/datadog/update_incident'
import {
  buildSloPayload,
  datadogApiUrl,
  datadogErrorMessage,
  mergeSloUpdatePayload,
  resolveDatadogSite,
  splitCommaList,
} from '@/tools/datadog/utils'

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

    const result = await executeUpdateSloOperation(
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

    const result = await executeUpdateSloOperation(
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

/**
 * `MuteMonitor` and `UnmuteMonitor` declare no `requestBody` in the authoritative
 * spec (`docs.datadoghq.com/resources/json/full_spec_v1.json`); `scope`, `end`,
 * and `all_scopes` are all `in: query`. Sent as a JSON body they are dropped, and
 * a scoped, time-boxed mute silently becomes an indefinite mute across every
 * scope — answered with a 200 and the full monitor object, so nothing surfaces.
 *
 * Note the generated `datadog-api-client-go` v1 schema omits these operations
 * entirely; it is a subset, not the authority.
 */
describe('monitor mute and unmute', () => {
  it('mutes with scope and end in the query string, not a body', () => {
    const url = callUrl(muteMonitorTool, {
      ...auth,
      monitorId: '123',
      scope: 'host:web-1',
      end: 1705323600,
    } as any)
    expect(url).toContain('/api/v1/monitor/123/mute?')
    expect(url).toContain('scope=host%3Aweb-1')
    expect(url).toContain('end=1705323600')
    expect(muteMonitorTool.request.body).toBeUndefined()
  })

  /** An indefinite, unscoped mute sends neither parameter and no stray `?`. */
  it('omits end and scope when the caller wants an indefinite mute', () => {
    const url = callUrl(muteMonitorTool, { ...auth, monitorId: '123' } as any)
    expect(url).toBe('https://api.datadoghq.com/api/v1/monitor/123/mute')
  })

  /** Muting is only safe to ship because it can be reversed from Sim. */
  it('ships an unmute counterpart that can clear every scope, also via query', () => {
    const url = callUrl(unmuteMonitorTool, {
      ...auth,
      monitorId: '123',
      allScopes: true,
    } as any)
    expect(url).toContain('/api/v1/monitor/123/unmute?')
    expect(url).toContain('all_scopes=true')
    expect(unmuteMonitorTool.request.body).toBeUndefined()
  })

  it('omits all_scopes and scope when the caller sets neither', () => {
    const url = callUrl(unmuteMonitorTool, { ...auth, monitorId: '123' } as any)
    expect(url).toBe('https://api.datadoghq.com/api/v1/monitor/123/unmute')
  })
})

describe('create_downtime monitor targeting', () => {
  /** monitor_identifier is a oneOf, so accepting both would silently drop one. */
  it('rejects a monitor ID and monitor tags together', () => {
    expect(() =>
      callBody(createDowntimeTool, {
        ...auth,
        scope: '*',
        monitorId: '123',
        monitorTags: 'team:backend',
      } as any)
    ).toThrow(/either a monitor ID or monitor tags, not both/)
  })

  it('rejects a non-numeric monitor ID instead of sending null', () => {
    expect(() =>
      callBody(createDowntimeTool, { ...auth, scope: '*', monitorId: 'abc' } as any)
    ).toThrow(/monitorIds must be a comma-separated list of whole numbers/)
  })

  it('falls back to the wildcard monitor tag when no monitor is named', () => {
    const body = callBody(createDowntimeTool, { ...auth, scope: '*' } as any)
    expect(body.data.attributes.monitor_identifier).toEqual({ monitor_tags: ['*'] })
  })

  it('targets a single monitor by numeric id', () => {
    const body = callBody(createDowntimeTool, { ...auth, scope: '*', monitorId: '123' } as any)
    expect(body.data.attributes.monitor_identifier).toEqual({ monitor_id: 123 })
  })

  /**
   * A `<Block.output>` reference to get_monitor resolves to a number, and an LLM tool
   * call can pass one too, so the parser must not assume a string.
   */
  it('accepts a monitor id that arrives as a number', () => {
    const body = callBody(createDowntimeTool, { ...auth, scope: '*', monitorId: 123 } as any)
    expect(body.data.attributes.monitor_identifier).toEqual({ monitor_id: 123 })
  })

  /** A blank monitor ID is how an untouched field arrives; it is not a chosen target. */
  it('does not treat a whitespace-only monitor id as a conflicting target', () => {
    const body = callBody(createDowntimeTool, {
      ...auth,
      scope: '*',
      monitorId: '   ',
      monitorTags: 'team:backend',
    } as any)
    expect(body.data.attributes.monitor_identifier).toEqual({ monitor_tags: ['team:backend'] })
  })

  it('accepts monitor tags that arrive as an array', () => {
    const body = callBody(createDowntimeTool, {
      ...auth,
      scope: '*',
      monitorTags: ['team:backend', 'priority:high'],
    } as any)
    expect(body.data.attributes.monitor_identifier).toEqual({
      monitor_tags: ['team:backend', 'priority:high'],
    })
  })
})

describe('splitCommaList input tolerance', () => {
  it('handles strings, numbers, and arrays without throwing', () => {
    expect(splitCommaList('a, b')).toEqual(['a', 'b'])
    expect(splitCommaList(123)).toEqual(['123'])
    expect(splitCommaList([1, 2])).toEqual(['1', '2'])
    expect(splitCommaList(undefined)).toBeUndefined()
    expect(splitCommaList('')).toBeUndefined()
  })
})

describe('path parameter encoding', () => {
  /** A pasted id often carries surrounding whitespace, which would 404 as `%20123`. */
  it('trims and encodes the monitor id in get_monitor', () => {
    const url = callUrl(getMonitorTool, { ...auth, monitorId: ' 12 3 ' } as any)
    expect(url).toContain('/api/v1/monitor/12%203')
    expect(url).not.toContain('/monitor/ 12')
  })

  it('trims and encodes the downtime id in cancel_downtime', () => {
    const url = callUrl(cancelDowntimeTool, { ...auth, downtimeId: ' a/b ' } as any)
    expect(url).toContain('/api/v2/downtime/a%2Fb')
    expect(url).not.toContain('/downtime/ a')
  })
})

describe('list_downtimes limit description', () => {
  /**
   * The Datadog v2 spec declares `default: 30` and `example: 100` but no `maximum`, so the
   * description must not present 100 as a vendor-enforced ceiling.
   */
  it('does not claim a vendor maximum', () => {
    const description = listDowntimesTool.params.limit.description ?? ''
    expect(description).not.toMatch(/max:\s*100/)
    expect(description).toMatch(/declares no maximum/)
  })
})

describe('list_monitors pagination', () => {
  /**
   * Datadog: `page_size` — "If the page argument is not specified, the default
   * behavior returns all monitors without a `page_size` limit." So a page size on
   * its own is inert, and a user who set one from a control that reads as a bound
   * would get every monitor in the org buffered whole.
   */
  it('sends page and page_size', () => {
    const url = callUrl(listMonitorsTool, { ...auth, page: 2, pageSize: 50 } as any)
    expect(url).toContain('page=2')
    expect(url).toContain('page_size=50')
  })

  it('implies page 0 when only a page size is set, so the bound actually applies', () => {
    const url = callUrl(listMonitorsTool, { ...auth, pageSize: 50 } as any)
    expect(url).toContain('page=0')
    expect(url).toContain('page_size=50')
  })

  /** An explicit page 0 is Datadog's first page, not an omission. */
  it('keeps an explicit page 0', () => {
    expect(callUrl(listMonitorsTool, { ...auth, page: 0 } as any)).toContain('page=0')
  })

  /**
   * Neither set stays unpaginated: defaulting `page` unconditionally would
   * silently truncate a caller relying on the documented return-everything
   * behavior, which is the same class of bug as a house `max_count` default.
   */
  it('sends no pagination when the caller sets neither', () => {
    const url = callUrl(listMonitorsTool, { ...auth } as any)
    expect(url).not.toContain('page')
  })

  it('states the page-dependency rule in both parameter descriptions', () => {
    expect(listMonitorsTool.params.page.description).toMatch(/without pagination/)
    expect(listMonitorsTool.params.pageSize.description).toMatch(/only applies this when a page/)
  })
})

describe('list_dashboards filters', () => {
  /** `filter[shared]` and `filter[deleted]` are incompatible, so an off toggle sends nothing. */
  it('omits both filters when neither is enabled', () => {
    const url = callUrl(listDashboardsTool, { ...auth, filterShared: false, filterDeleted: false })
    expect(url).not.toContain('filter%5Bshared%5D')
    expect(url).not.toContain('filter%5Bdeleted%5D')
  })

  it('sends only the filter that is enabled', () => {
    const url = callUrl(listDashboardsTool, { ...auth, filterShared: true, filterDeleted: false })
    expect(url).toContain('filter%5Bshared%5D=true')
    expect(url).not.toContain('filter%5Bdeleted%5D')
  })
})

describe('submit_metrics errors output', () => {
  /** `errors` is the only signal that Datadog rejected part of an accepted submission. */
  it('reports errors on the success path', async () => {
    const result = await submitMetricsTool.transformResponse!(
      jsonResponse({ errors: ['metric name too long'] })
    )
    expect(result.success).toBe(true)
    expect(result.output.errors).toEqual(['metric name too long'])
  })

  it('reports errors on the failure path', async () => {
    const result = await submitMetricsTool.transformResponse!(
      jsonResponse({ errors: ['bad payload'] }, { status: 400 })
    )
    expect(result.success).toBe(false)
    expect(result.output.errors).toEqual(['bad payload'])
  })
})

describe('registry surface', () => {
  it('keeps create_event on api-key-only auth', () => {
    expect(createEventTool.params.applicationKey).toBeUndefined()
  })
})

describe('undisclosed vendor limits and Sim defaults', () => {
  /**
   * `EventCreateRequest.date_happened` is documented "Limited to events no older
   * than 18 hours". A backfill outside that window is rejected, or accepted and
   * clamped, for a reason nothing in the tool explained.
   */
  it('discloses the 18-hour ceiling on create_event date_happened', () => {
    expect(createEventTool.params.dateHappened.description).toMatch(/18 hours/)
  })

  /**
   * `ddsource: 'custom'` is injected by Sim, not by Datadog — and it decides
   * which log pipeline Datadog applies, so it must not read as a vendor default.
   */
  it('discloses that ddsource="custom" is a Sim default', () => {
    const description = String(sendLogsTool.params.logs.description)

    expect(description).toMatch(/ddsource="custom"/)
    expect(description).toMatch(/Sim default, not a Datadog one/)
  })

  it('still applies that default so an entry without ddsource is not sent bare', () => {
    const body = callBody(sendLogsTool, {
      ...auth,
      logs: JSON.stringify([{ message: 'hello' }]),
    } as any)

    expect(body[0].ddsource).toBe('custom')
  })
})

describe('datadog site is validated before it reaches the request host', () => {
  /*
   * `DatadogSite` is a compile-time union and is erased at runtime, so it kept
   * nothing out of the URL. Every Datadog request carries DD-API-KEY and
   * DD-APPLICATION-KEY, so an unchecked `site` chose where those were sent.
   */
  it('rejects an arbitrary host', () => {
    expect(() => datadogApiUrl('evil.com' as never, '/api/v1/slo')).toThrow(
      /Datadog "site" must be one of/
    )
  })

  it('rejects a host smuggled in as userinfo', () => {
    expect(() => datadogApiUrl('datadoghq.com@evil.com' as never, '/api/v1/slo')).toThrow(
      /Datadog "site" must be one of/
    )
  })

  it('rejects a value that would escape the host into a path', () => {
    expect(() => datadogApiUrl('datadoghq.com/../..' as never, '/api/v1/slo')).toThrow(
      /Datadog "site" must be one of/
    )
  })

  it('defaults an absent site to US1 and keeps every published region', () => {
    expect(datadogApiUrl(undefined, '/api/v1/slo')).toBe('https://api.datadoghq.com/api/v1/slo')
    for (const site of DATADOG_SITES) {
      expect(datadogApiUrl(site, '/x')).toBe(`https://api.${site}/x`)
      expect(resolveDatadogSite(site)).toBe(site)
    }
  })

  it('builds the logs intake host from the validated site', () => {
    const url = sendLogsTool.request.url({
      apiKey: 'k',
      site: 'datadoghq.eu',
      logs: '[]',
    } as never)
    expect(url).toBe('https://http-intake.logs.datadoghq.eu/api/v2/logs')
    expect(() =>
      sendLogsTool.request.url({ apiKey: 'k', site: 'evil.com', logs: '[]' } as never)
    ).toThrow(/Datadog "site" must be one of/)
  })
})
