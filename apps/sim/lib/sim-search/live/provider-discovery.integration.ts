import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { nativeSearchQuerySchema } from '@/lib/api/contracts/mothership-assistant-tools'
import { McpClient } from '@/lib/mcp/client'
import { compileMcpToolSchema } from '@/lib/mcp/tool-schema'
import type { McpToolSchemaProperty } from '@/lib/mcp/types'
import { searchLucidMcp } from '@/lib/sim-search/live/lucid-mcp'
import type { ManagedSearchMcpClient } from '@/lib/sim-search/live/managed-mcp'
import { managedMcpPayload } from '@/lib/sim-search/live/managed-mcp-payload'
import { searchNotionMcp } from '@/lib/sim-search/live/notion-mcp'

const ID = '00000000-0000-4000-8000-000000000001'
const ID2 = '00000000-0000-4000-8000-000000000002'
const stamp = '2026-09-20T12:00:00Z'
const folder = { id: 42, type: 'folder', name: 'Architecture', isShortcut: false }
const lucidDocument = {
  id: ID,
  type: 'document',
  name: 'Topology',
  product: 'lucidchart',
  isShortcut: false,
}
const notionDocument = { type: 'page', title: 'Decisions', url: `https://www.notion.so/${ID}` }
const field = { type: 'string' }
const tool = (
  name: string,
  properties: Record<string, McpToolSchemaProperty>,
  required: string[] = []
) => ({
  name,
  inputSchema: { type: 'object' as const, properties, required, additionalProperties: false },
})
const schemas = [
  tool('lucid_list_folder_contents', {
    folder_id: { type: 'integer' },
    page_size: { type: 'integer', minimum: 1, maximum: 200 },
    page_token: field,
  }),
  tool('lucid_get_document_metadata', { document_id: field }, ['document_id']),
  tool('notion-get-tool-access', {}),
  ...['private', 'shared', 'favorite', 'recent'].map((list) =>
    tool(`notion-list-${list}-pages`, { limit: { type: 'number' }, cursor: field })
  ),
  ...['notion-search', 'notion-ai-search'].map((name) =>
    tool(
      name,
      {
        query: field,
        query_type: { enum: ['internal'] },
        page_size: { type: 'integer', maximum: 50 },
        page_url: field,
        sort: { enum: ['relevance', 'last_edited', 'created'] },
        filters: {
          type: 'object',
          properties: {
            last_edited_date_range: {
              type: 'object',
              properties: {
                start_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
                end_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
              },
            },
          },
          additionalProperties: false,
        },
      },
      ['query']
    )
  ),
  tool('notion-fetch', { id: field }, ['id']),
]
let restricted = false
let providerOffset = 0
let ai = false
let mode = ''
let calls = 0
const requests: { name: string; args: Record<string, unknown> }[] = []
const protocol = new Server(
  { name: 'discovery-fixture', version: '1' },
  { capabilities: { tools: {} } }
)
const payload = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data) }],
})
protocol.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: schemas }))
protocol.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  calls++
  if (calls > 12) throw Error('Exceeded per-query provider budget')
  const args = params.arguments ?? {}
  requests.push({ name: params.name, args })
  const schema = schemas.find((value) => value.name === params.name)
  if (!schema || !compileMcpToolSchema(schema.inputSchema)(args))
    throw Error('Provider rejected arguments')
  if (params.name === 'lucid_list_folder_contents') {
    if (mode === 'oversize')
      return payload({
        items: Array.from({ length: 11 }, () => lucidDocument),
        nextPageToken: 'after-omitted',
      })
    if (mode === 'invalid-cursor') return payload({ items: [], nextPageToken: 123 })
    if (mode === 'unsafe')
      return payload({
        items: [
          { ...lucidDocument, isShortcut: true },
          { id: 'https://evil.invalid', type: 'folder', name: 'Unsafe', isShortcut: false },
        ],
      })
    if (args.folder_id === 42) return payload({ items: [{ ...lucidDocument, id: ID2 }] })
    return payload(
      args.page_token ? { items: [lucidDocument] } : { items: [folder], nextPageToken: 'page-two' }
    )
  }
  if (params.name === 'lucid_get_document_metadata')
    return payload({
      documentId: args.document_id,
      title: 'Topology',
      product: 'lucidchart',
      viewUrl: `https://lucid.app/lucidchart/${args.document_id}/view`,
      version: 7,
      pageCount: 1,
      lastModified: stamp,
    })
  if (params.name === 'notion-get-tool-access')
    return payload({
      current_tool_access: {
        [ai ? 'ai_search' : 'search']: {
          status: 'available',
          restricted_parameters: restricted
            ? {
                [mode === 'restricted-child'
                  ? 'filters.last_edited_date_range.start_date'
                  : 'filters.last_edited_date_range']: 'Plan restriction',
                sort: 'Plan restriction',
              }
            : {},
        },
        ...Object.fromEntries(
          ['private', 'shared', 'favorite', 'recent'].map((list) => [
            `list_${list}_pages`,
            { status: 'available' },
          ])
        ),
      },
    })
  if (params.name.startsWith('notion-list-'))
    return payload(
      args.cursor
        ? { results: [{ ...notionDocument, url: `https://www.notion.so/${ID2}` }] }
        : { results: [notionDocument], nextCursor: 'offset:1' }
    )
  if (params.name === 'notion-fetch')
    return payload({
      id: args.id,
      text: 'Authoritative page content',
      page_last_edited_at:
        mode === 'date-boundary'
          ? args.id === ID
            ? '2026-09-19T11:00:00Z'
            : '2026-09-20T10:59:59Z'
          : stamp,
    })
  if (params.name === 'notion-search' || params.name === 'notion-ai-search') {
    const dates = toRecord(toRecord(args.filters).last_edited_date_range)
    if (mode === 'restricted-child' && dates.start_date) throw Error('Restricted field was sent')
    if (!args.query && !args.sort && !Object.keys(dates).length)
      throw Error('Empty search has no constraint')
    if (mode === 'date-boundary') {
      const candidates = [
        { ...notionDocument, edited: '2026-09-19T11:00:00Z' },
        { ...notionDocument, url: `https://www.notion.so/${ID2}`, edited: '2026-09-20T10:59:59Z' },
      ]
      return payload({
        results: candidates.filter((row) => {
          const date = new Date(Date.parse(row.edited) + providerOffset * 3_600_000)
            .toISOString()
            .slice(0, 10)
          return (
            (typeof dates.start_date !== 'string' || date >= dates.start_date) &&
            (typeof dates.end_date !== 'string' || date < dates.end_date)
          )
        }),
      })
    }
    return payload({
      type: ai ? 'ai_search' : 'workspace_search',
      results: [notionDocument],
      ...(mode === 'notice' ? { notices: [{ message: 'Filter was ignored' }] } : {}),
    })
  }
  throw Error('Unexpected provider operation')
})
const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: generateId })
const server = createServer((req, res) => {
  void transport.handleRequest(req, res).catch(() => res.end())
})
let client: McpClient
let available = new Set(schemas.map((value) => value.name))
const reader: ManagedSearchMcpClient = {
  hasTool: (name) => available.has(name),
  hasArgument(name, path) {
    let schema: Record<string, unknown> = toRecord(
      schemas.find((value) => value.name === name)?.inputSchema
    )
    for (const key of path.split('.')) {
      schema = toRecord(toRecord(schema.properties)[key])
      if (!Object.keys(schema).length) return false
    }
    return true
  },
  async call(name, args) {
    return managedMcpPayload(
      await client.callTool(
        { name, arguments: args },
        { signal: AbortSignal.timeout(5000), timeoutMs: 5000 }
      ),
      name.startsWith('notion') ? 'Notion' : 'Lucid'
    )
  },
}
const browse = (provider: string, mode: string, extra = {}) => ({
  query: '',
  limit: 10,
  scopes: [],
  native: nativeSearchQuerySchema.parse({ provider, query: '', browse: mode, ...extra }),
})
beforeAll(async () => {
  await protocol.connect(transport)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  client = new McpClient({
    config: {
      id: 'discovery-fixture',
      name: 'Discovery',
      transport: 'streamable-http',
      url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`,
      authType: 'none',
    },
    resolvedIP: '127.0.0.1',
    securityPolicy: { requireConsent: false, auditLevel: 'none' },
  })
  await client.connect()
  await client.listTools()
})
beforeEach(() => {
  calls = 0
  requests.length = 0
  mode = ''
  restricted = false
  ai = false
  available = new Set(schemas.map((value) => value.name))
})
afterAll(async () => {
  await client?.disconnect()
  await protocol.close()
  await transport.close()
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections()
  })
})

describe('Provider discovery over real MCP HTTP', () => {
  it('lists Lucid root folders, continues empty document pages, and reads a selected child folder', async () => {
    const first = await searchLucidMcp(reader, browse('lucid', 'folder'))
    expect(first).toMatchObject({
      documents: [],
      folders: [{ id: '42', name: 'Architecture' }],
      nextCursor: 'page-two',
    })
    calls = 0
    const next = await searchLucidMcp(
      reader,
      browse('lucid', 'folder', { cursor: first.nextCursor })
    )
    expect(next.documents.map((item) => item.id)).toEqual([ID])
    calls = 0
    const child = await searchLucidMcp(reader, browse('lucid', 'folder', { project: '42' }))
    expect(child.documents.map((item) => item.id)).toEqual([ID2])
  })
  for (const failure of ['oversize', 'invalid-cursor'])
    it(`rejects ${failure} folder pages instead of issuing a lossy continuation`, async () => {
      mode = failure
      await expect(searchLucidMcp(reader, browse('lucid', 'folder'))).rejects.toThrow()
    })
  it('excludes shortcuts and malformed folder identities with incomplete coverage', async () => {
    mode = 'unsafe'
    const page = await searchLucidMcp(reader, browse('lucid', 'folder'))
    expect(page).toMatchObject({ documents: [], partial: true })
    expect(page.folders ?? []).toEqual([])
  })
  for (const list of ['private', 'shared', 'favorites', 'recent'])
    it(`browses Notion ${list} with cursor without guessing keywords`, async () => {
      const first = await searchNotionMcp(reader, browse('notion', list))
      expect(first.documents.map((item) => item.id)).toEqual([ID])
      expect(first.nextCursor).toBe('offset:1')
      calls = 0
      const next = await searchNotionMcp(
        reader,
        browse('notion', list, { cursor: first.nextCursor })
      )
      expect(next.documents.map((item) => item.id)).toEqual([ID2])
      expect(requests.some((call) => call.name === 'notion-search')).toBe(false)
    })
  it('refuses a browse tool missing from the connection', async () => {
    available.delete('notion-list-private-pages')
    await expect(searchNotionMcp(reader, browse('notion', 'private'))).rejects.toThrow(
      /unavailable|advertise/i
    )
  })
  it.each([-12, 14])(
    'retains boundary candidates with provider day offset %s and returns current timestamps',
    async (offset) => {
      providerOffset = offset
      mode = 'date-boundary'
      const page = await searchNotionMcp(reader, {
        query: '',
        limit: 10,
        scopes: [],
        filters: {
          startDate: '2026-09-20T01:00:00+14:00',
          endDate: '2026-09-21T01:00:00+14:00',
          sortBy: 'newest',
        },
      })
      expect(page.documents.map((document) => [document.id, document.modifiedAt])).toEqual([
        [ID, '2026-09-19T11:00:00Z'],
        [ID2, '2026-09-20T10:59:59Z'],
      ])
      expect(requests.find((call) => call.name === 'notion-search')?.args.filters).toBeTruthy()
      expect(requests.find((call) => call.name === 'notion-search')?.args.sort).toBe('last_edited')
    }
  )
  it.each(['restricted-parent', 'restricted-child'])(
    'refuses date-only search when the plan restricts %s',
    async (restriction) => {
      mode = restriction
      restricted = true
      await expect(
        searchNotionMcp(reader, {
          query: '',
          limit: 10,
          scopes: [],
          filters: { startDate: stamp, sortBy: 'newest' },
        })
      ).rejects.toThrow(/plan|supported|available/i)
    }
  )
  it('preserves topical AI routing and reports dropped provider constraints', async () => {
    ai = true
    mode = 'notice'
    const page = await searchNotionMcp(reader, { query: 'launch decisions', limit: 10, scopes: [] })
    expect(page.documents[0]?.id).toBe(ID)
    expect(page.partial).toBe(true)
    expect(requests.some((call) => call.name === 'notion-ai-search')).toBe(true)
  })
})
