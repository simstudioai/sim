import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { isHosted } from '@/lib/core/config/env-flags'
import { McpClient } from '@/lib/mcp/client'
import { NativeSearchError } from '@/lib/sim-search/live/http'
import type { ManagedSearchMcpClient } from '@/lib/sim-search/live/managed-mcp'
import { managedMcpPayload } from '@/lib/sim-search/live/managed-mcp-payload'
import { readZoomMcp, searchZoomMcp } from '@/lib/sim-search/live/zoom-mcp'

/** Official Zoom MCP wire shapes over real HTTP; synthetic data, not live Zoom acceptance. */
const logger = createLogger('SearchZoomE2E')
const reportPath = process.env.SEARCH_ZOOM_REPORT_PATH
assert(reportPath, 'Set SEARCH_ZOOM_REPORT_PATH')
assert(!isHosted, 'Use a local self-hosted URL with NEXT_PUBLIC_FORCE_HOSTED=false')
const ID = '00000000-0000-4000-8000-000000000001'
const OTHER_ID = '00000000-0000-4000-8000-000000000002'
const SLASH_ID = '/synthetic//occurrence=='
const toolNames = ['search_meetings', 'get_meeting_assets']
const checks: { name: string; status: string; durationMs: number; error?: string }[] = []
const requests: { tool: string; status: string }[] = []
let mode = ''
let calls = 0
let active = 0
let peakActive = 0
let observerRequests = 0
let padding = ''
let lastSearch: Record<string, unknown> = {}
let signal = new AbortController().signal
let enteredContent: (() => void) | undefined
let blockedContent: (() => void) | undefined
const result = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  isError: false,
})
const protocol = new Server(
  { name: 'synthetic-zoom', version: '1.0.0' },
  { capabilities: { tools: {} } }
)
protocol.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolNames.map((name) => ({ name, inputSchema: { type: 'object' as const } })),
}))
protocol.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params
  calls++
  requests.push({ tool: name, status: mode || 'success' })
  assert(calls <= 12, 'Exceeded the production per-operation request budget')
  if (name === 'search_meetings') {
    lastSearch = args
    assert(
      Object.keys(args).every((key) =>
        ['q', 'from', 'to', 'page_size', 'next_page_token'].includes(key)
      )
    )
    if (mode === 'invalid-page') return result({ meetings: 'not-an-array' })
    const count =
      mode === 'bounded' ? 10 : mode === 'overflow' ? 11 : mode.startsWith('candidate-') ? 2 : 1
    const meetings = Array.from({ length: count }, (_, index) => ({
      meeting_uuid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      meeting_category: 'history',
      topic: 'Synthetic architecture review',
      schedule_start_time: '2025-01-01T00:00:00Z',
      meeting_start_time: '2026-09-01T12:00:00Z',
      join_url: `${origin}/observer?pwd=private-passcode-sentinel`,
    }))
    if (mode === 'identity')
      meetings.push(
        { ...meetings[0]!, meeting_uuid: '12345678901', meeting_category: 'history' },
        { ...meetings[0]!, meeting_uuid: OTHER_ID, meeting_category: 'scheduled_upcoming' }
      )
    return result({
      meetings: args.q === 'absent' ? [] : meetings,
      next_page_token: mode === 'continuation' || mode === 'overflow' ? 'opaque-page-2' : '',
    })
  }
  assert.equal(name, 'get_meeting_assets')
  assert.equal(typeof args.meetingId, 'string')
  const id = String(args.meetingId).startsWith('%')
    ? decodeURIComponent(decodeURIComponent(String(args.meetingId)))
    : args.meetingId
  if (id === SLASH_ID) assert.equal(args.meetingId, '%252Fsynthetic%252F%252Foccurrence%253D%253D')
  if (mode === 'candidate-rate' || mode === 'candidate-error')
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: mode === 'candidate-rate' ? 'Rate limit reached' : 'private-error-sentinel',
        },
      ],
    }
  active++
  peakActive = Math.max(peakActive, active)
  try {
    if (mode === 'bounded') await sleep(20)
    if (mode === 'cancel') {
      enteredContent?.()
      await new Promise<void>((resolve) => {
        blockedContent = resolve
      })
    }
    const denied = mode === 'denied'
    const missing = mode === 'missing-flags'
    const permission = missing ? {} : { has_permission: !denied }
    return result({
      meeting_uuid:
        mode === 'wrong-id' || (mode === 'candidate-stale' && id === ID) ? OTHER_ID : id,
      meeting_category: mode === 'upcoming' ? 'upcoming' : 'history',
      topic: 'Synthetic architecture review',
      start_time: '2026-09-01T12:00:00Z',
      deep_url:
        mode === 'unsafe-url'
          ? `${origin}/observer`
          : mode === 'secret-url'
            ? 'https://zoom.us/meeting/insights?pwd=private-passcode-sentinel'
            : 'https://zoom.us/meeting/insights/synthetic',
      host_email: 'private-host-sentinel@example.invalid',
      attendee_list: [{ email: 'private-attendee-sentinel@example.invalid' }],
      meeting_transcript: {
        primary_language: 'en',
        transcript_items:
          mode === 'nodes'
            ? Array.from({ length: 10001 }, () => ({ text: 'oversized', start: '0', end: '1' }))
            : [
                {
                  text: mode === 'malformed-item' ? 42 : 'Verbatim meeting evidence',
                  start: '00:01',
                  end: '00:03',
                },
              ],
      },
      my_notes: {
        content_markdown:
          padding ||
          (mode === 'changed-note'
            ? 'An edited personal decision note'
            : 'My personal decision notes'),
        file_link: `${origin}/observer`,
        file_id: 'private-file-id-sentinel',
        transcript: {
          primary_language: 'en',
          transcript_items: [{ text: 'Personal dictated note', start: '00:05', end: '00:06' }],
        },
      },
      meeting_summary: {
        ...permission,
        ...(mode === 'recording-only' ? { has_permission: false } : {}),
        has_summary: mode !== 'no-assets',
        summary_plain_text:
          mode === 'changed-summary' ? 'An edited AI interpretation' : 'AI-summary-sentinel',
        summary_web_url: `${origin}/observer`,
      },
      recording: {
        ...permission,
        ...(mode === 'summary-only' ? { has_permission: false } : {}),
        has_recording: mode !== 'no-assets',
        processing: mode === 'processing',
        play_url: `${origin}/observer?pwd=private-passcode-sentinel`,
        cdn_urls: [`${origin}/observer`],
        transcripts: [
          { timeline: [{ text: 'Recording-transcript-sentinel', ts: '00:02', end_ts: '00:04' }] },
        ],
        summaries: [
          {
            overall_summary: 'Recording-summary-sentinel',
            items: [{ label: 'Decision', summary: 'Recording-chapter-sentinel' }],
          },
        ],
      },
      docs: [{ url: `${origin}/observer` }],
    })
  } finally {
    active--
  }
})
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: generateId,
  enableJsonResponse: true,
})
await protocol.connect(transport)
const server = http.createServer((request, response) => {
  if (request.url !== '/mcp') {
    observerRequests++
    response.writeHead(404).end()
    return
  }
  if (mode === 'transport-error' && request.method === 'POST') {
    response.writeHead(503).end('Unavailable')
    return
  }
  void transport.handleRequest(request, response).catch(() => {
    if (!response.headersSent) response.writeHead(500)
    response.end()
  })
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
const client = new McpClient({
  config: {
    id: 'synthetic-zoom',
    name: 'Synthetic Zoom',
    transport: 'streamable-http',
    url: `${origin}/mcp`,
    authType: 'none',
  },
  resolvedIP: '127.0.0.1',
  securityPolicy: { requireConsent: false, auditLevel: 'none' },
})
const reader: ManagedSearchMcpClient = {
  async call(name, args) {
    signal.throwIfAborted()
    assert(toolNames.includes(name))
    return managedMcpPayload(
      await client.callTool({ name, arguments: args }, { signal, timeoutMs: 5000 }),
      'Zoom'
    )
  },
}
const read = (id = ID) => readZoomMcp(reader, id)
const search = (query = 'architecture') => searchZoomMcp(reader, { query, scopes: [], limit: 10 })
async function check(name: string, run: () => Promise<void>) {
  mode = ''
  calls = 0
  active = 0
  peakActive = 0
  padding = ''
  signal = new AbortController().signal
  const start = performance.now()
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: performance.now() - start })
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: performance.now() - start,
      error: getErrorMessage(error),
    })
    process.exitCode = 1
  }
}
try {
  await client.connect()
  await client.listTools()
  await check(
    'Historical occurrence identity excludes recurring numbers and upcoming meetings',
    async () => {
      mode = 'identity'
      const page = await search()
      assert.deepEqual(
        page.documents.map((document) => document.id),
        [ID]
      )
      assert.equal(page.partial, true)
      assert.equal(page.documents[0]?.eventStartAt, '2026-09-01T12:00:00Z')
      assert.equal(page.documents[0]?.modifiedAt, undefined)
    }
  )
  await check(
    'Authorized asset read keeps transcripts and notes separate from AI interpretations',
    async () => {
      const document = await read()
      assert(document.content.includes('[00:01 – 00:03] Verbatim meeting evidence'))
      assert(document.content.includes('Personal notes\nMy personal decision notes'))
      assert(
        document.content.includes(
          'Personal notes transcript (en)\n[00:05 – 00:06] Personal dictated note'
        )
      )
      assert(document.content.includes('AI-generated meeting summary\nAI-summary-sentinel'))
      assert(
        document.content.includes(
          'Recording transcript segment 1\n[00:02 – 00:04] Recording-transcript-sentinel'
        )
      )
      assert(
        document.content.includes(
          'AI-generated recording chapter: Decision\nRecording-chapter-sentinel'
        )
      )
      assert(!JSON.stringify(document).includes('private-'))
      assert(!document.content.includes(origin))
      assert.equal(observerRequests, 0)
    }
  )
  for (const [change, editedText] of [
    ['changed-note', 'An edited personal decision note'],
    ['changed-summary', 'An edited AI interpretation'],
  ] as const)
    await check(
      `An edited ${change} cannot splice read windows from the original search`,
      async () => {
        const original = (await search()).documents[0]!
        const unchanged = await readZoomMcp(reader, original.id, original.revision)
        assert(unchanged.content.includes('My personal decision notes'))
        assert(unchanged.content.includes('AI-summary-sentinel'))
        mode = change
        await assert.rejects(
          () => readZoomMcp(reader, original.id, original.revision),
          (error: unknown) =>
            error instanceof NativeSearchError && /changed.*[Ss]earch again/.test(error.message)
        )
        const current = (await search()).documents[0]!
        const updated = await readZoomMcp(reader, current.id, current.revision)
        assert(updated.content.includes(editedText))
      }
    )
  for (const failure of ['denied', 'missing-flags', 'no-assets'])
    await check(
      `Permission/availability ${failure} cannot leak summary or recording text`,
      async () => {
        mode = failure
        const document = await read()
        assert(!document.content.includes('AI-summary-sentinel'))
        assert(!document.content.includes('Recording-transcript-sentinel'))
        assert(!document.content.includes('Recording-summary-sentinel'))
        assert(document.content.includes('Verbatim meeting evidence'))
        assert(document.content.includes('My personal decision notes'))
        assert(document.content.includes('absent or not permitted'))
      }
    )
  await check('Processing recording assets disclose incomplete coverage', async () => {
    mode = 'processing'
    assert((await read()).content.includes('still processing and may be incomplete'))
  })
  await check(
    'Slash UUID is double encoded and response stays bound to raw occurrence',
    async () => {
      assert.equal((await read(SLASH_ID)).id, SLASH_ID)
      await assert.rejects(() => read('12345678901'), /UUID/)
      assert.equal(calls, 1)
    }
  )
  for (const failure of [
    'wrong-id',
    'upcoming',
    'unsafe-url',
    'secret-url',
    'malformed-item',
    'nodes',
  ])
    await check(`Read fails closed for ${failure}`, async () => {
      mode = failure
      await assert.rejects(
        () => read(),
        (error: unknown) => error instanceof NativeSearchError
      )
    })
  for (const permitted of ['summary-only', 'recording-only'])
    await check(`${permitted} permission cannot authorize the other asset section`, async () => {
      mode = permitted
      const content = (await read()).content
      assert.equal(content.includes('AI-summary-sentinel'), permitted === 'summary-only')
      assert.equal(
        content.includes('Recording-transcript-sentinel'),
        permitted === 'recording-only'
      )
    })
  await check('Exact UTF8 output limit succeeds and an additional byte fails', async () => {
    padding = 'x'
    const overhead = Buffer.byteLength((await read()).content, 'utf8') - 1
    const remaining = 512 * 1024 - overhead
    padding = 'é'.repeat(Math.floor(remaining / 2)) + 'x'.repeat(remaining % 2)
    assert.equal(Buffer.byteLength((await read()).content, 'utf8'), 512 * 1024)
    padding += 'x'
    await assert.rejects(() => read(), /512 KiB/)
  })
  await check(
    'Malformed candidate metadata preserves independently readable siblings with partial warning',
    async () => {
      mode = 'candidate-stale'
      const page = await search()
      assert.deepEqual(
        page.documents.map((document) => document.id),
        [OTHER_ID]
      )
      assert.equal(page.partial, true)
      assert.match(page.message ?? '', /excluded/)
    }
  )
  for (const [failure, status] of [
    ['candidate-error', 'unavailable'],
    ['candidate-rate', 'rate_limited'],
  ] as const)
    await check(`Candidate ${status} failure remains terminal`, async () => {
      mode = failure
      await assert.rejects(
        search,
        (error: unknown) =>
          error instanceof NativeSearchError &&
          error.status === status &&
          !error.message.includes('private-error-sentinel')
      )
    })
  await check('Candidate hydration remains within operation and concurrency budgets', async () => {
    mode = 'bounded'
    const page = await search()
    assert.equal(page.documents.length, 10)
    assert(calls <= 12)
    assert(peakActive > 1 && peakActive <= 3)
  })
  await check(
    'Overfull provider page cannot skip results through an invented continuation',
    async () => {
      mode = 'overflow'
      const page = await search()
      assert.equal(page.documents.length, 10)
      assert.equal(page.nextCursor, undefined)
      assert.equal(page.partial, true)
      assert.equal(page.hasMore, true)
    }
  )
  await check(
    'Date query maps actual meeting bounds and forwards opaque continuation',
    async () => {
      mode = 'continuation'
      const page = await searchZoomMcp(reader, {
        query: '',
        scopes: [],
        limit: 10,
        filters: { startDate: '2026-09-01T00:00:00Z', endDate: '2026-09-02T00:00:00Z' },
        native: { provider: 'zoom', query: '', cursor: 'opaque-page-1', kind: 'meeting' },
      })
      assert.equal(page.nextCursor, 'opaque-page-2')
      assert.equal(lastSearch.from, '2026-08-31T23:59:59.000Z')
      assert.equal(lastSearch.to, '2026-09-02T00:00:00.000Z')
      assert.equal(lastSearch.q, undefined)
      assert.equal(lastSearch.next_page_token, 'opaque-page-1')
    }
  )
  await check(
    'Unsupported narrowing fails before network instead of widening the query',
    async () => {
      await assert.rejects(
        () =>
          searchZoomMcp(reader, {
            query: 'q',
            scopes: [],
            limit: 10,
            filters: { modifiedAfter: '2026-09-01T00:00:00Z' },
          }),
        /unsupported/
      )
      for (const selector of [
        { modifiers: 'owner:me' },
        { termClauses: ['owner:me'] },
        { keywordOnly: true },
      ])
        await assert.rejects(
          () =>
            searchZoomMcp(reader, {
              query: 'q',
              scopes: [],
              limit: 10,
              native: { provider: 'zoom', query: 'q', ...selector },
            }),
          /unsupported/
        )
      await assert.rejects(
        () =>
          searchZoomMcp(reader, {
            query: 'q',
            scopes: [],
            limit: 10,
            native: { provider: 'zoom', query: 'q', project: '12345678901' },
          }),
        /unsupported/
      )
      await assert.rejects(
        () =>
          searchZoomMcp(reader, {
            query: 'q',
            scopes: [],
            limit: 10,
            native: { provider: 'zoom', query: 'q', kind: 'issues' },
          }),
        /unsupported/
      )
      await assert.rejects(() => search(''), /requires/)
      assert.equal(calls, 0)
    }
  )
  await check('Malformed search envelope is not an empty success', async () => {
    mode = 'invalid-page'
    await assert.rejects(search, /unsupported/)
  })
  await check('HTTP provider failure cannot become a successful empty result', async () => {
    mode = 'transport-error'
    await assert.rejects(search)
  })
  await check('Cancellation during asset retrieval cannot return a complete document', async () => {
    mode = 'cancel'
    const controller = new AbortController()
    signal = controller.signal
    const arrived = new Promise<void>((resolve) => {
      enteredContent = resolve
    })
    const reading = read()
    const rejection = assert.rejects(reading)
    await Promise.race([
      arrived,
      reading.then(() => {
        throw new Error('Read did not wait for content')
      }),
    ])
    controller.abort(new Error('cancelled Zoom verification'))
    blockedContent?.()
    await rejection
  })
} finally {
  blockedContent?.()
  await client.disconnect()
  await protocol.close()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(
    reportPath,
    JSON.stringify({ fixture: 'synthetic-loopback-mcp', checks, requests }, null, 2)
  )
  logger.info('Zoom MCP verification finished', {
    passed: checks.filter((check) => check.status === 'passed').length,
    failed: checks.filter((check) => check.status === 'failed').length,
    reportPath,
  })
}
