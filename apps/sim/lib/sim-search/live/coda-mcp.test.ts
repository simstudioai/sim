/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runtime: vi.fn(),
  discover: vi.fn(),
  execute: vi.fn(),
  auth: vi.fn(),
  validate: vi.fn(),
}))
vi.mock('@/lib/sim-search/live/mcp-accounts', () => ({ loadOwnCodaMcpRuntime: mocks.runtime }))
vi.mock('@/lib/mcp/service', () => ({
  mcpService: { discoverManagedMcpTools: mocks.discover, executeManagedMcpTool: mocks.execute },
}))
vi.mock('@/lib/mcp/application/managed-auth-provider', () => ({
  createManagedMcpAuthProvider: mocks.auth,
}))
vi.mock('@/lib/mcp/application/execute-tool', () => ({ validateToolArguments: mocks.validate }))

import {
  type CodaMcpClient,
  codaMcpPayload,
  createCodaMcpClient,
  readCodaMcp,
  searchCodaMcp,
} from '@/lib/sim-search/live/coda-mcp'

const input = { query: 'launch', limit: 20, scopes: [] }

describe('Coda MCP content search', () => {
  beforeEach(() => vi.clearAllMocks())
  it('accepts structured and JSON text output, and rejects tool failures', () => {
    expect(codaMcpPayload({ structuredContent: { results: [] } })).toEqual({ results: [] })
    expect(
      codaMcpPayload({ structuredContent: { toolName: 'search', result: { results: [] } } })
    ).toEqual({ results: [] })
    expect(codaMcpPayload({ content: [{ type: 'text', text: '{"results":[]}' }] })).toEqual({
      results: [],
    })
    expect(
      codaMcpPayload({
        content: [{ type: 'text', text: '{"toolName":"search","result":{"results":[]}}' }],
      })
    ).toEqual({ results: [] })
    expect(() =>
      codaMcpPayload({ isError: true, content: [{ type: 'text', text: 'secret' }] })
    ).toThrow('Coda could not complete')
    expect(() =>
      codaMcpPayload({
        isError: true,
        content: [{ type: 'text', text: "You've reached your weekly limit of 30 MCP requests." }],
      })
    ).toThrow('Coda MCP request limit reached')
  })
  it('passes content queries and document filters, preserving the opaque cursor', async () => {
    const call = vi.fn<CodaMcpClient['call']>().mockResolvedValue({
      results: [
        {
          uri: 'coda://docs/doc/pages/page',
          title: 'Launch plan',
          url: 'https://coda.io/d/doc',
          snippet: 'Release next week',
        },
      ],
      nextCursor: 'next',
    })
    const page = await searchCodaMcp(
      { call },
      {
        ...input,
        native: {
          provider: 'coda',
          query: 'release next week',
          project: 'coda://docs/doc',
          cursor: 'previous',
        },
      }
    )
    expect(call).toHaveBeenCalledWith('search', {
      query: 'release next week',
      types: ['page', 'tableRow'],
      docUri: 'coda://docs/doc',
      cursor: 'previous',
      limit: 10,
    })
    expect(page).toMatchObject({
      nextCursor: 'next',
      partial: false,
      documents: [{ id: 'coda://docs/doc/pages/page', kind: 'mcp', content: 'Release next week' }],
    })
  })
  it('maps the current Superhuman Docs page result shape', async () => {
    const call = vi.fn<CodaMcpClient['call']>().mockResolvedValue({
      results: [
        {
          docUri: 'superhuman://docs/doc',
          pageUri: 'pages/section-page#Readable%20title',
          pageName: 'Federated search fixture',
          docTitle: 'Sim Search QA',
          pageContent: 'SimSearchCodaFixtureBeta',
          url: 'https://docs.superhuman.com/d/doc/page',
        },
      ],
      hasMore: false,
    })
    expect(await searchCodaMcp({ call }, input)).toMatchObject({
      documents: [
        {
          id: 'superhuman://docs/doc/pages/section-page',
          title: 'Federated search fixture',
          content: 'SimSearchCodaFixtureBeta',
        },
      ],
      partial: false,
    })
  })
  it('uses the documented empty-query recency listing and reports local date filtering', async () => {
    const call = vi.fn<CodaMcpClient['call']>().mockResolvedValue({
      results: [{ uri: 'coda://docs/doc', title: 'Recent document', updatedAt: '2026-09-20' }],
    })
    const page = await searchCodaMcp(
      { call },
      { ...input, query: ' ', filters: { modifiedAfter: '2026-09-01T00:00:00Z' } }
    )
    expect(call).toHaveBeenCalledWith('search', { query: '', limit: 10 })
    expect(page).toMatchObject({ partial: true, documents: [{ id: 'coda://docs/doc' }] })
    expect(page.message).toContain('Date filters apply to returned timestamps in Sim')
  })
  it('rejects page-scoped document filters before calling the provider', async () => {
    const call = vi.fn<CodaMcpClient['call']>()
    await expect(
      searchCodaMcp(
        { call },
        { ...input, native: { provider: 'coda', query: 'term', project: 'coda://docs/d/pages/p' } }
      )
    ).rejects.toThrow('requires a document URI')
    expect(call).not.toHaveBeenCalled()
  })
  it('does not claim complete coverage for an unrecognized result shape', async () => {
    const call = vi.fn<CodaMcpClient['call']>().mockResolvedValue({ unexpected: [] })
    await expect(searchCodaMcp({ call }, input)).rejects.toThrow('unsupported result format')
  })
  it('reads page content and the exact matched row with read-only tools', async () => {
    const call = vi
      .fn<CodaMcpClient['call']>()
      .mockResolvedValue({ webUrl: 'https://coda.io/d/doc', markdown: 'Evidence' })
    const page = await readCodaMcp({ call }, 'coda://docs/doc/pages/page')
    expect(call).toHaveBeenLastCalledWith(
      'content_read',
      expect.objectContaining({
        uri: 'coda://docs/doc/pages/page',
        contentTypesToInclude: ['markdown', 'tables'],
      })
    )
    expect(page.content).toContain('Evidence')
    await readCodaMcp({ call }, 'superhuman://docs/doc/pages/section-page#Readable%20title')
    expect(call).toHaveBeenLastCalledWith(
      'content_read',
      expect.objectContaining({ uri: 'superhuman://docs/doc/pages/section-page' })
    )
    await readCodaMcp({ call }, 'coda://docs/doc/tables/table/rows/row')
    expect(call).toHaveBeenLastCalledWith('table_rows_read', {
      uri: 'coda://docs/doc/tables/table',
      rowNumbersOrIds: ['row'],
      rowLimit: 1,
    })
  })
  it('does not send arbitrary URLs or malformed references to the server', async () => {
    const call = vi.fn<CodaMcpClient['call']>()
    await expect(readCodaMcp({ call }, 'https://evil.example/doc')).rejects.toThrow(
      'unsupported resource URI'
    )
    await expect(readCodaMcp({ call }, 'coda://docs/a/../../b')).rejects.toThrow(
      'unsupported resource URI'
    )
    expect(call).not.toHaveBeenCalled()
  })
  it('validates fresh tool schemas and rechecks personal grants before each execution', async () => {
    const runtime = {
      mcpServerId: 'server',
      credentialId: 'mine',
      scope: { kind: 'organization', organizationId: 'org' },
      oauthConfigVersion: 1,
      grantedAt: new Date(0),
    }
    mocks.runtime.mockResolvedValue(runtime)
    mocks.discover.mockResolvedValue([{ name: 'search', inputSchema: { type: 'object' } }])
    mocks.execute.mockResolvedValue({ structuredContent: { results: [] } })
    const client = await createCodaMcpClient(
      { organizationId: 'org' },
      'person',
      'mine',
      new AbortController().signal
    )
    await client.call('search', { query: 'term' })
    expect(mocks.runtime).toHaveBeenLastCalledWith({ organizationId: 'org' }, 'person', 'mine')
    expect(mocks.validate).toHaveBeenCalledWith(expect.objectContaining({ name: 'search' }), {
      query: 'term',
    })
    mocks.runtime.mockResolvedValue({ ...runtime, grantedAt: new Date(1) })
    await expect(client.call('search', { query: 'term' })).rejects.toThrow('connection changed')
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    await expect(client.call('formula_execute' as never, {})).rejects.toThrow('read request limit')
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })
})
