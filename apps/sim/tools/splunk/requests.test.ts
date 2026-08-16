/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { cancelSearchJobTool } from '@/tools/splunk/cancel_search_job'
import { createSearchJobTool } from '@/tools/splunk/create_search_job'
import { dispatchSavedSearchTool } from '@/tools/splunk/dispatch_saved_search'
import { getFiredAlertsTool } from '@/tools/splunk/get_fired_alerts'
import { getSearchResultsTool } from '@/tools/splunk/get_search_results'
import { listAppsTool } from '@/tools/splunk/list_apps'
import { listFiredAlertsTool } from '@/tools/splunk/list_fired_alerts'
import { listIndexesTool } from '@/tools/splunk/list_indexes'
import { listSavedSearchesTool } from '@/tools/splunk/list_saved_searches'

const BASE = { baseUrl: 'https://splunk.example.com:8089' }

function buildBody(tool: typeof createSearchJobTool, params: Record<string, unknown>): string {
  const body = tool.request.body
  if (!body) throw new Error('tool has no body builder')
  return body(params as Parameters<NonNullable<typeof tool.request.body>>[0]) as unknown as string
}

describe('createSearchJobTool exec_mode', () => {
  it('defaults to normal when the caller leaves it empty', () => {
    expect(buildBody(createSearchJobTool, { ...BASE, search: 'index=main' })).toContain(
      'exec_mode=normal'
    )
  })

  it('rejects oneshot instead of returning a job with no search ID', () => {
    expect(() =>
      buildBody(createSearchJobTool, { ...BASE, search: 'index=main', execMode: 'oneshot' })
    ).toThrow(/cannot use exec_mode=oneshot/)
  })

  it('rejects an execution mode Splunk does not define', () => {
    expect(() =>
      buildBody(createSearchJobTool, { ...BASE, search: 'index=main', execMode: 'turbo' })
    ).toThrow(/Invalid Splunk execution mode/)
  })
})

describe('listSavedSearchesTool', () => {
  it('limits the response with f, which the reference prescribes for this endpoint', () => {
    const url = listSavedSearchesTool.request.url({ ...BASE } as never)
    expect(url).toContain('f=search')
    expect(url).toContain('f=cron_schedule')
  })
})

describe('getFiredAlertsTool', () => {
  it('sends no pagination to an endpoint documented as taking no request parameters', () => {
    const url = getFiredAlertsTool.request.url({ ...BASE, name: 'Errors' } as never)
    expect(url).toBe(
      'https://splunk.example.com:8089/services/alerts/fired_alerts/Errors?output_mode=json'
    )
    expect(url).not.toContain('count=')
    expect(url).not.toContain('offset=')
  })
})

describe('getSearchResultsTool count bound', () => {
  /**
   * Splunk documents `count=0` as "return all available results" and nothing
   * downstream bounds it — the whole body is buffered with a single
   * `response.text()` and every row is materialized. The sid may name a scheduled
   * job whose `dispatch.max_count` defaults to 500000.
   */
  it.each([0, '0'])('rejects count=%s rather than issuing an unbounded read', (count) => {
    expect(() => getSearchResultsTool.request.url({ ...BASE, sid: '1.1', count } as never)).toThrow(
      /unbounded/
    )
  })

  it('still sends a positive count, and omits an untouched one', () => {
    expect(
      getSearchResultsTool.request.url({ ...BASE, sid: '1.1', count: 500 } as never)
    ).toContain('count=500')

    const untouched = getSearchResultsTool.request.url({
      ...BASE,
      sid: '1.1',
      count: null,
    } as never)
    expect(untouched).not.toContain('count=')
  })
})

/**
 * `output_mode` is absent from the documented parameter table for the dispatching
 * and job-control endpoints, whose only documented response is the XML
 * `<response><sid>...</sid></response>`. Parsing that as JSON threw, which reported
 * a cancel that really did cancel as a failure and lost the search ID of a job
 * that had already been created.
 */
const SPLUNK_XML_SID = '<?xml version="1.0"?><response><sid>1457683115.100</sid></response>'

describe('POST tools tolerate an XML body', () => {
  it('reports a successful cancel instead of a JSON parse failure', async () => {
    const result = await cancelSearchJobTool.transformResponse?.(
      new Response(SPLUNK_XML_SID, { status: 200 }),
      { ...BASE, sid: '1457683115.100' } as never
    )

    expect(result?.success).toBe(true)
    expect(result?.output.sid).toBe('1457683115.100')
  })

  /**
   * The dispatch was accepted and the job exists, so the search ID is read out of
   * the XML rather than discarded. Failing here would strand a job the caller can
   * no longer poll or cancel.
   */
  it.each([
    ['create_search_job', createSearchJobTool],
    ['dispatch_saved_search', dispatchSavedSearchTool],
  ])('keeps the search ID %s returned in XML', async (_label, tool) => {
    const result = await tool.transformResponse?.(
      new Response(SPLUNK_XML_SID, { status: 200 }),
      BASE as never
    )

    expect(result?.success).toBe(true)
    expect(result?.output.sid).toBe('1457683115.100')
  })

  /**
   * A body cut off mid-transfer must not read as a complete envelope: on a cancel
   * that would report a truncated response as a successful cancellation.
   */
  it('rejects a truncated envelope on cancel', async () => {
    await expect(
      cancelSearchJobTool.transformResponse?.(
        new Response('<response><sid>145768311', { status: 200 }),
        { ...BASE, sid: '1457683115.100' } as never
      )
    ).rejects.toThrow()
  })
})

/**
 * Splunk answers every collection endpoint with a `paging` envelope. Without
 * projecting `total`, a full page and the last page are indistinguishable, so
 * `offset` is unusable as a pagination control.
 */
describe('list tools project the paging envelope', () => {
  const PAGING_BODY = JSON.stringify({
    entry: [{ name: 'one', content: {} }],
    paging: { total: 412, perPage: 30, offset: 30 },
  })

  it.each([
    ['list_saved_searches', listSavedSearchesTool],
    ['list_apps', listAppsTool],
    ['list_indexes', listIndexesTool],
    ['list_fired_alerts', listFiredAlertsTool],
  ])('%s reports total and offset', async (_label, tool) => {
    const result = await tool.transformResponse?.(new Response(PAGING_BODY), BASE as never)

    expect(result?.output).toMatchObject({ total: 412, offset: 30 })
  })

  it.each([
    ['list_saved_searches', listSavedSearchesTool],
    ['list_apps', listAppsTool],
    ['list_indexes', listIndexesTool],
    ['list_fired_alerts', listFiredAlertsTool],
  ])('%s declares total and offset as outputs', (_label, tool) => {
    expect(tool.outputs).toHaveProperty('total')
    expect(tool.outputs).toHaveProperty('offset')
  })
})
