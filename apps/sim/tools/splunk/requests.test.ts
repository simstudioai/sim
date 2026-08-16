/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { cancelSearchJobTool } from '@/tools/splunk/cancel_search_job'
import { createSearchJobTool } from '@/tools/splunk/create_search_job'
import { dispatchSavedSearchTool } from '@/tools/splunk/dispatch_saved_search'
import { getFiredAlertsTool } from '@/tools/splunk/get_fired_alerts'
import { getSearchJobTool } from '@/tools/splunk/get_search_job'
import { getSearchResultsTool } from '@/tools/splunk/get_search_results'
import { listAppsTool } from '@/tools/splunk/list_apps'
import { listFiredAlertsTool } from '@/tools/splunk/list_fired_alerts'
import { listIndexesTool } from '@/tools/splunk/list_indexes'
import { listSavedSearchesTool } from '@/tools/splunk/list_saved_searches'
import { runSearchTool } from '@/tools/splunk/run_search'

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
  /**
   * `name=-` returns the fired alerts of every saved search, and this endpoint
   * documents "Request parameters: None" — there is no `count`/`offset` to bound
   * that read, so the wildcard has to be disclosed rather than offered flatly.
   */
  it('warns that the - wildcard has no count or offset to bound it', () => {
    const description = String(getFiredAlertsTool.params.name.description)

    expect(description).toMatch(/Request parameters: None/)
    expect(description).toMatch(/count|offset/)
  })

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

/**
 * The reference renders the job entry's `earliestTime` as an ISO string but
 * `searchEarliestTime` as a bare number (`1308589800.000000000`). Reading it with
 * `asString` returned `null` for every JSON response, which is what
 * `output_mode=json` always produces.
 */
describe('getSearchJobTool time bounds', () => {
  const JOB_BODY = JSON.stringify({
    entry: [
      {
        name: '1457683115.100',
        content: {
          sid: '1457683115.100',
          earliestTime: '2011-06-20T09:30:00.000-07:00',
          latestTime: '2011-06-20T10:30:00.000-07:00',
          searchEarliestTime: 1308589800.0,
          searchLatestTime: 1308593400.0,
        },
      },
    ],
  })

  it('reads the epoch search time bounds instead of dropping them', async () => {
    const result = await getSearchJobTool.transformResponse?.(new Response(JOB_BODY), BASE as never)

    expect(result?.output.searchEarliestTime).toBe(1308589800)
    expect(result?.output.searchLatestTime).toBe(1308593400)
  })

  it('declares them as numbers', () => {
    expect(getSearchJobTool.outputs?.searchEarliestTime).toMatchObject({ type: 'number' })
    expect(getSearchJobTool.outputs?.searchLatestTime).toMatchObject({ type: 'number' })
  })

  /**
   * Every one of these is `| null` in the transform, so declaring them required
   * promises the workflow a value a queued or failed job does not carry.
   */
  it.each([
    'sid',
    'dispatchState',
    'isDone',
    'isFailed',
    'isFinalized',
    'isPaused',
    'isZombie',
    'isSaved',
    'isSavedSearch',
    'isRealTimeSearch',
    'eventCount',
    'resultCount',
    'scanCount',
  ])('declares the nullable output %s as optional', (key) => {
    expect(getSearchJobTool.outputs?.[key]).toMatchObject({ optional: true })
  })
})

/**
 * `max_count` is not a house-defaulted memory bound. Splunk documents it as "the
 * number of events that can be accessible in any given status bucket. Also, in
 * transforming mode, the maximum number of results to store" — so sending an
 * unrequested default truncates a transforming search (`| stats`, `| timechart`)
 * below what Splunk would have stored, with no error and no message.
 */
describe('runSearchTool max_count', () => {
  it('sends no max_count at all when the caller sets nothing', () => {
    expect(buildBody(runSearchTool, { ...BASE, search: 'index=main' })).not.toContain('max_count')
  })

  it.each([
    ['null', null],
    ['empty string', ''],
  ])('treats %s as unset rather than sending a literal', (_label, maxCount) => {
    const body = buildBody(runSearchTool, { ...BASE, search: 'index=main', maxCount })

    expect(body).not.toContain('max_count')
  })

  it('sends the caller-supplied bound verbatim', () => {
    expect(buildBody(runSearchTool, { ...BASE, search: 'index=main', maxCount: 50 })).toContain(
      'max_count=50'
    )
  })

  it('does not claim a Sim-specific default in the parameter description', () => {
    expect(runSearchTool.params.maxCount.description).not.toMatch(/\b1000\b/)
    expect(runSearchTool.params.maxCount.description).toMatch(/Defaults to 10000/)
    expect(runSearchTool.params.maxCount.description).toMatch(/transforming mode/)
  })
})

/**
 * `scripts/generate-docs.ts` parses tool source text and resolves an `outputs`
 * const only from the family's `types.ts`, so a shared const anywhere else makes
 * the published table fall back to the block's union of every operation's outputs.
 * These fields must stay written out inline.
 */
describe('result-returning tools declare their outputs inline', () => {
  it.each([
    ['run_search', runSearchTool],
    ['get_search_results', getSearchResultsTool],
  ])('%s types results as an array of rows', (_label, tool) => {
    expect(tool.outputs?.results).toMatchObject({ type: 'array', items: { type: 'object' } })
    expect(tool.outputs?.messages).toMatchObject({ type: 'array' })
    expect(tool.outputs).not.toHaveProperty('savedSearches')
    expect(tool.outputs).not.toHaveProperty('firedAlerts')
    expect(tool.outputs).not.toHaveProperty('indexes')
    expect(tool.outputs).not.toHaveProperty('apps')
  })
})

/**
 * The only documented response for `POST search/jobs/{sid}/control` is XML, so
 * reading `data.messages` off a JSON body left this array empty on every cancel.
 */
describe('cancelSearchJobTool messages', () => {
  it('reports the messages the job-control response carried', async () => {
    const result = await cancelSearchJobTool.transformResponse?.(
      new Response(
        '<response><messages><msg type="INFO">Search job cancelled.</msg></messages></response>',
        { status: 200 }
      ),
      { ...BASE, sid: '1457683115.100' } as never
    )

    expect(result?.output.messages).toEqual([{ type: 'INFO', text: 'Search job cancelled.' }])
  })

  it('declares messages as an output', () => {
    expect(cancelSearchJobTool.outputs?.messages).toMatchObject({ type: 'array' })
  })
})
