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
import { generateId } from '@sim/utils/id'
import { isHosted } from '@/lib/core/config/env-flags'
import { McpClient } from '@/lib/mcp/client'
import { NativeSearchError } from '@/lib/sim-search/live/http'
import { readLucidMcp, searchLucidMcp } from '@/lib/sim-search/live/lucid-mcp'
import type { ManagedSearchMcpClient } from '@/lib/sim-search/live/managed-mcp'
import { managedMcpPayload } from '@/lib/sim-search/live/managed-mcp-payload'

/** Real MCP transport with synthetic provider fixtures; not a live Lucid-account run. */
const logger = createLogger('SearchLucidE2E')
const reportPath = process.env.SEARCH_LUCID_REPORT_PATH
assert(reportPath, 'Set SEARCH_LUCID_REPORT_PATH')
assert(!isHosted, 'Use a local self-hosted URL with NEXT_PUBLIC_FORCE_HOSTED=false')
const ID = '00000000-0000-4000-8000-000000000001'
const OTHER_ID = '00000000-0000-4000-8000-000000000002'
const TITLE = 'Synthetic topology'
const checks: { name: string; status: string; durationMs: number; error?: string }[] = []
const requests: { tool: string; status: string }[] = []
let mode = ''
let counts = [2, 1]
let metadataReads = 0
let calls = 0
let contentCalls = 0
let padding = ''
let blockedContent: (() => void) | undefined
let enteredContent: (() => void) | undefined
let observerRequests = 0
const url = (id = ID, product = 'lucidchart') => `https://lucid.app/${product}/${id}/edit`
const nodeData = (page: number, region: number) => ({
  nodes: [
    {
      id: `node-${page}-${region}`,
      label: `Page ${page} region ${region} — café`,
      properties: { image: `${origin}/observer`, link: `${origin}/observer`, padding },
    },
  ],
  edges: [
    {
      id: `edge-${page}-${region}`,
      sourceId: 'api',
      targetId: 'database',
      properties: {
        Endpoint1: 'style: None, connectedBlockId: api',
        Endpoint2: 'style: Arrow, connectedBlockId: database',
      },
    },
  ],
  customDiagramFamily: { preserved: ['custom data', 'group membership'] },
})
const fixturePage = (page: number, regions: number[]) => ({
  pageId: `page-${page}`,
  pageTitle: `Page ${page}`,
  pageIndex: page - 1,
  textDefaults: { fontSize: '10' },
  totalChunks: counts[page - 1],
  requestedChunks: regions.map((region) => ({
    chunkIndex: region - 1,
    data: nodeData(page, region),
  })),
})
const result = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  structuredContent: { widgetInstance: { toolName: 'fixture', id: 'widget-only' } },
  isError: false,
})
const failed = () => ({
  content: [{ type: 'text' as const, text: 'private-provider-error-sentinel' }],
  isError: true,
})
const toolNames = ['search', 'fetch', 'lucid_search_document', 'lucid_get_document_metadata']
const protocol = new Server(
  { name: 'synthetic-lucid', version: '1.0.0' },
  { capabilities: { tools: {} } }
)
protocol.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolNames.map((name) => ({ name, inputSchema: { type: 'object' as const } })),
}))
protocol.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params
  calls++
  requests.push({ tool: name, status: mode || 'success' })
  assert(calls <= 12, 'Exceeded the production per-read MCP request budget')
  if (mode === 'tool-error') return failed()
  if (name === 'lucid_get_document_metadata') {
    metadataReads++
    if (args.document_id === ID && mode === 'candidate-error') return failed()
    if (args.document_id === ID && mode === 'candidate-rate')
      return { ...failed(), content: [{ type: 'text' as const, text: 'Rate limit reached' }] }
    if (mode === 'revoked' && metadataReads > 1) return failed()
    return result({
      documentId:
        mode === 'metadata-id' || (mode === 'stale-candidate' && args.document_id === ID)
          ? OTHER_ID
          : args.document_id,
      title: TITLE,
      product: mode === 'spark' ? 'lucidspark' : 'lucidchart',
      viewUrl:
        mode === 'unsafe-url'
          ? 'https://attacker.invalid/other'
          : url(String(args.document_id), mode === 'spark' ? 'lucidspark' : 'lucidchart'),
      lastModified: '2026-09-01T12:00:00Z',
      created: '2020-01-01T00:00:00Z',
      version: mode === 'changed' && metadataReads > 1 ? 8 : 7,
      pageCount: mode === 'metadata-pages' ? 3 : counts.length,
      canEdit: false,
      trashed: mode === 'trashed' ? true : null,
    })
  }
  if (name === 'search') {
    assert.equal(typeof args.query, 'string')
    assert(
      Array.isArray(args.product) &&
        args.product.every((product) => product === 'lucidchart' || product === 'lucidspark')
    )
    assert(
      Object.keys(args).every((key) => ['query', 'product', 'last_modified_after'].includes(key))
    )
    const rowCount =
      mode === 'search-cap'
        ? 200
        : ['stale-candidate', 'candidate-error', 'candidate-rate'].includes(mode)
          ? 2
          : 1
    return result({
      query: args.query,
      results:
        args.query === 'absent'
          ? []
          : Array.from({ length: rowCount }, (_, index) => {
              const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
              return { id, title: TITLE, url: url(id), parent: null }
            }),
    })
  }
  if (name === 'lucid_search_document') {
    assert.equal(args.id, ID)
    assert(Array.isArray(args.queries) && args.queries.every((query) => typeof query === 'string'))
    return result({
      document_id: mode === 'scoped-id' ? OTHER_ID : ID,
      title: TITLE,
      edit_url: url(),
      matches: Object.fromEntries(
        (args.queries as string[]).map((query) => [
          query,
          query === 'absent'
            ? []
            : [
                {
                  pageIndex: mode === 'scoped-page' ? 3 : 2,
                  regionIndex: 1,
                  context: ['API Gateway'],
                },
              ],
        ])
      ),
    })
  }
  assert.equal(name, 'fetch')
  assert.equal(args.id, ID)
  const manifest = {
    document_id: mode === 'content-id' ? OTHER_ID : ID,
    title: TITLE,
    edit_url: url(ID, mode === 'spark' ? 'lucidspark' : 'lucidchart'),
    metadata: {
      page_count: counts.length,
      page_region_counts: mode === 'fractional' ? [1.5, 1] : counts,
    },
  }
  if (args.metadata_only) return result(manifest)
  contentCalls++
  if (mode === 'cancel') {
    enteredContent?.()
    await new Promise<void>((resolve) => {
      blockedContent = resolve
    })
  }
  assert(typeof args.page_index === 'number')
  const page = args.page_index
  assert(Number.isInteger(page) && page >= 1 && page <= counts.length)
  const regions = Array.isArray(args.region_index) ? args.region_index : []
  assert(
    regions.every(
      (region) => Number.isInteger(region) && region >= 1 && region <= counts[page - 1]!
    )
  )
  const data = fixturePage(page, regions)
  if (mode === 'duplicate-page-id') data.pageId = 'page-1'
  if (mode === 'wrong-page') data.pageIndex++
  if (mode === 'wrong-region' && data.requestedChunks[0]) data.requestedChunks[0].chunkIndex++
  if (mode === 'missing-region') data.requestedChunks = []
  if (mode === 'duplicate-region' && data.requestedChunks[0])
    data.requestedChunks.push(data.requestedChunks[0])
  if (mode === 'changed-page-id' && regions[0] === 2) data.pageId = 'replacement-page'
  return result({
    ...manifest,
    page_id: data.pageId,
    page_index: page,
    metadata: { ...manifest.metadata, page_index: page },
    text: mode === 'malformed-json' ? '{invalid' : JSON.stringify({ pages: [data] }),
  })
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
  void transport.handleRequest(request, response).catch(() => {
    if (!response.headersSent) response.writeHead(500)
    response.end()
  })
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
const client = new McpClient({
  config: {
    id: 'synthetic-lucid',
    name: 'Synthetic Lucid',
    transport: 'streamable-http',
    url: `${origin}/mcp`,
    authType: 'none',
  },
  resolvedIP: '127.0.0.1',
  securityPolicy: { requireConsent: false, auditLevel: 'none' },
})
let signal = new AbortController().signal
const reader: ManagedSearchMcpClient = {
  async call(name, args) {
    signal.throwIfAborted()
    assert(toolNames.includes(name))
    return managedMcpPayload(
      await client.callTool({ name, arguments: args }, { signal, timeoutMs: 5000 }),
      'Lucid'
    )
  },
}
const read = (revision = '7') => readLucidMcp(reader, { id: ID, revision })
const search = (query = 'topology') => searchLucidMcp(reader, { query, scopes: [], limit: 10 })
async function check(name: string, run: () => Promise<void>) {
  mode = ''
  counts = [2, 1]
  metadataReads = 0
  contentCalls = 0
  calls = 0
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
    'Real MCP widget envelope preserves title result and modification timestamp',
    async () => {
      const page = await search()
      assert.deepEqual(
        page.documents.map((document) => document.id),
        [ID]
      )
      assert.equal(page.documents[0]?.modifiedAt, '2026-09-01T12:00:00Z')
      assert.equal((await search('absent')).documents.length, 0)
    }
  )
  for (const product of ['chart', 'spark'])
    await check(
      `${product} complete read preserves all regions and directed edges without fetching links`,
      async () => {
        mode = product === 'spark' ? 'spark' : ''
        const document = await read()
        const data = JSON.parse(document.content)
        assert.equal(document.kind, product === 'spark' ? 'lucidspark' : 'lucidchart')
        assert.equal(data.pages.length, 2)
        assert.deepEqual(
          data.pages.map((page: Record<string, unknown>) => page.pageId),
          ['page-1', 'page-2']
        )
        assert.equal(data.pages[1].requestedChunks[0].data.nodes[0].label, 'Page 2 region 1 — café')
        assert.equal(data.pages[0].requestedChunks[1].data.edges[0].sourceId, 'api')
        assert.equal(data.pages[0].requestedChunks[1].data.edges[0].targetId, 'database')
        assert.deepEqual(data.pages[1].requestedChunks[0].data.customDiagramFamily.preserved, [
          'custom data',
          'group membership',
        ])
        assert.equal(observerRequests, 0)
        assert(calls <= 12)
      }
    )
  await check('Scoped text search binds matches to the requested document', async () => {
    const page = await searchLucidMcp(reader, {
      query: 'API Gateway',
      scopes: [],
      limit: 10,
      native: { provider: 'lucid', query: 'API Gateway', project: url() },
    })
    assert.equal(page.documents[0]?.id, ID)
    assert(page.documents[0]?.content.includes('Page 2, region 1: API Gateway'))
    mode = 'scoped-id'
    await assert.rejects(
      () =>
        searchLucidMcp(reader, {
          query: 'API Gateway',
          scopes: [],
          limit: 10,
          native: { provider: 'lucid', query: 'API Gateway', project: ID },
        }),
      /identity/
    )
  })
  await check('Scoped text cannot claim a nonexistent page', async () => {
    mode = 'scoped-page'
    await assert.rejects(
      () =>
        searchLucidMcp(reader, {
          query: 'API',
          scopes: [],
          limit: 10,
          native: { provider: 'lucid', query: 'API', project: ID },
        }),
      /document-search/
    )
  })
  for (const failure of [
    'metadata-id',
    'unsafe-url',
    'trashed',
    'metadata-pages',
    'duplicate-page-id',
    'content-id',
    'fractional',
    'wrong-page',
    'wrong-region',
    'missing-region',
    'duplicate-region',
    'changed-page-id',
    'malformed-json',
    'changed',
    'revoked',
    'tool-error',
  ])
    await check(`Withhold complete read on ${failure}`, async () => {
      mode = failure
      await assert.rejects(
        read,
        (error) =>
          error instanceof NativeSearchError &&
          !error.message.includes('private-provider-error-sentinel')
      )
    })
  await check('Older reference revision cannot splice a new read window', async () => {
    await assert.rejects(() => read('6'), /changed/)
  })
  await check('Manifest preflight rejects over-budget reads before fetching content', async () => {
    counts = [8, 1]
    await assert.rejects(read, /limit/)
    assert.equal(contentCalls, 0)
  })
  await check('All eight regions fit the existing request budget', async () => {
    counts = [4, 4]
    const document = await read()
    assert.equal(JSON.parse(document.content).pages[1].requestedChunks.length, 4)
    assert(calls <= 12)
  })
  await check('Complete UTF8 output at cap succeeds; one extra byte fails', async () => {
    counts = [1]
    const expected = { document_id: ID, title: TITLE, pages: [fixturePage(1, [1])] }
    const remaining = 512 * 1024 - Buffer.byteLength(JSON.stringify(expected), 'utf8')
    padding = 'é'.repeat(Math.floor(remaining / 2)) + 'x'.repeat(remaining % 2)
    assert.equal(Buffer.byteLength((await read()).content, 'utf8'), 512 * 1024)
    calls = 0
    metadataReads = 0
    padding += 'x'
    await assert.rejects(read, /512 KiB/)
  })
  await check(
    'A stale candidate cannot discard another independently readable document',
    async () => {
      mode = 'stale-candidate'
      const page = await search()
      assert.deepEqual(
        page.documents.map((document) => document.id),
        [OTHER_ID]
      )
      assert.equal(page.partial, true)
      assert.match(page.message ?? '', /excluded/i)
    }
  )
  for (const [failure, status] of [
    ['candidate-error', 'unavailable'],
    ['candidate-rate', 'rate_limited'],
  ] as const) {
    await check(`Candidate provider failure ${status} remains terminal`, async () => {
      mode = failure
      await assert.rejects(
        () => search(),
        (error: unknown) => error instanceof NativeSearchError && error.status === status
      )
    })
  }
  await check('Capped title search discloses coverage without inventing a cursor', async () => {
    mode = 'search-cap'
    const page = await search()
    assert.equal(page.documents.length, 10)
    assert.equal(page.partial, true)
    assert.equal(page.hasMore, true)
    assert.equal(page.nextCursor, undefined)
    assert(calls <= 12)
  })
  await check('Unsupported cursor and oversized terms fail before a provider request', async () => {
    await assert.rejects(() => search(''), /requires search terms/)
    await assert.rejects(() => search('x'.repeat(401)), /400/)
    await assert.rejects(
      () =>
        searchLucidMcp(reader, {
          query: 'a',
          scopes: [],
          limit: 10,
          native: { provider: 'lucid', query: 'a', cursor: 'opaque' },
        }),
      /continuation/
    )
    assert.equal(calls, 0)
  })
  await check(
    'Cancellation during a content request cannot return a complete document',
    async () => {
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
          throw new Error('Read finished without reaching the held content request')
        }),
      ])
      controller.abort(new Error('cancelled Lucid verification'))
      blockedContent?.()
      await rejection
      assert.equal(contentCalls, 1)
    }
  )
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
  logger.info('Lucid MCP verification finished', {
    passed: checks.filter((check) => check.status === 'passed').length,
    failed: checks.filter((check) => check.status === 'failed').length,
    reportPath,
  })
}
