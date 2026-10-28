import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { apiServerRoutesMock } from '@sim/testing/mocks/api-server-routes.mock'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { urlsMockFns } from '@sim/testing/mocks/urls.mock'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  tools: new Map<
    string,
    (input: Record<string, unknown>, extra: { signal: AbortSignal }) => Promise<CallToolResult>
  >(),
  configs: new Map<
    string,
    { description: string; inputSchema: { parse: (input: unknown) => unknown } }
  >(),
  liveSearch: vi.fn(),
  liveRead: vi.fn(),
  chat: vi.fn(),
  rateLimit: vi.fn(),
  afterResponse: vi.fn<(task: () => Promise<void>) => void>(),
  recordActivity: vi.fn(),
}))
vi.mock('@/lib/core/utils/after-response', () => ({ afterResponse: hoisted.afterResponse }))
vi.mock('@/lib/knowledge/mcp/activity', () => ({
  recordOrganizationSearchMcpActivity: hoisted.recordActivity,
}))
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    registerTool(
      name: string,
      config: { description: string; inputSchema: { parse: (input: unknown) => unknown } },
      run: (
        input: Record<string, unknown>,
        extra: { signal: AbortSignal }
      ) => Promise<CallToolResult>
    ) {
      hoisted.tools.set(name, run)
      hoisted.configs.set(name, config)
    }
  },
}))
vi.mock('@/lib/api/server/routes/v2-json-route', () => ({
  ...apiServerRoutesMock,
  v2RateLimits: { publicApi: { enforce: hoisted.rateLimit } },
}))
vi.mock('@/lib/sim-search/live/application', () => ({
  searchLiveKnowledge: { execute: hoisted.liveSearch },
  readLiveDocument: { execute: hoisted.liveRead },
}))
vi.mock('@/lib/knowledge/application/chat', () => ({
  organizationSearchChat: { execute: hoisted.chat },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { createKnowledgeMcpServer } from '@/lib/knowledge/mcp/server'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const mocks = hoisted

urlsMockFns.mockGetBaseUrl.mockReturnValue('https://sim.example')

const principal = createPersonalApiKeyPrincipal({ userId: 'person-1' })
const auth = {
  principal,
  keyType: 'personal' as const,
  keyExpiresAt: null,
  rateLimitSubjectIds: ['person-1'] as const,
  rateLimitSubscription: null,
}
const request = new NextRequest('http://localhost/api/mcp/search/organizations/org-1')
function create() {
  createKnowledgeMcpServer({ organizationId: 'org-1', request, auth })
}
function call(tool: string, input: Record<string, unknown>, signal = new AbortController().signal) {
  const run = mocks.tools.get(tool)
  if (!run) throw new Error(`Missing tool ${tool}`)
  return run(input, { signal })
}

beforeEach(() => {
  mocks.tools.clear()
  mocks.configs.clear()
  mocks.rateLimit.mockReset().mockResolvedValue(null)
  mocks.liveSearch.mockResolvedValue({ results: [] })
  mocks.chat.mockResolvedValue({ content: 'An answer', citations: [] })
})

describe('live organization Search MCP', () => {
  const documentId = `live:${'a'.repeat(500)}`
  const document = {
    documentId,
    knowledgeBaseId: '',
    documentName: 'Release notes',
    sourceUrl: 'https://example.com/notes',
    sourceModifiedAt: '2026-09-22T10:00:00Z',
    connectorType: 'google_drive',
    content: 'Live evidence',
    chunkIndex: 0,
  }
  const coverage = {
    backend: 'live',
    accounts: [
      { accountId: 'account-1', provider: 'google_drive', status: 'partial', nextCursor: 'page-2' },
    ],
    guidance: 'Use nativeQueries to continue.',
  }
  beforeEach(() => {
    mocks.liveSearch.mockResolvedValue({
      results: [document],
      live: coverage,
      retrieval: { status: 'partial' },
    })
    mocks.liveRead.mockResolvedValue({
      ...document,
      knowledgeBaseName: 'Drive',
      chunks: [
        {
          chunkIndex: 0,
          content: 'More evidence',
          startOffset: 8000,
          endOffset: 16000,
          totalCharacters: 20000,
        },
      ],
      hasMore: true,
      next: { startChunkIndex: 0, startOffset: 16000 },
    })
  })

  it.each(['search', 'read_document'])(
    'does not return live %s content after an authorization denial',
    async (tool) => {
      create()
      const backend = tool === 'search' ? mocks.liveSearch : mocks.liveRead
      backend.mockRejectedValueOnce(new OrchestrationError('forbidden', 'Access denied'))
      const result = await call(tool, tool === 'search' ? { query: 'release' } : { documentId })
      expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'Access denied' }] })
    }
  )

  it.each([
    [{ query: 'release' }, 30],
    [{ query: 'release', topK: 12 }, 12],
    [{ query: 'release', source: 'slack' }, 20],
    [{ query: 'release', sortBy: 'relevance' }, 30],
    [{ query: 'release', sortBy: 'newest' }, 20],
    [
      {
        query: 'release',
        nativeQueries: [{ provider: 'slack', accountId: 'account-1', query: 'release' }],
      },
      20,
    ],
    [{ query: '', startDate: '2026-09-01T00:00:00Z' }, 20],
  ])('searches %o for up to %i previews', async (input, topK) => {
    create()
    mocks.liveSearch.mockClear()
    await call('search', input)
    expect(mocks.liveSearch).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ topK }) })
    )
  })

  it.each(['search', 'read_document'])(
    'refuses live %s content with incomplete secret provenance',
    async (tool) => {
      create()
      const backend = tool === 'search' ? mocks.liveSearch : mocks.liveRead
      backend.mockImplementationOnce(
        async ({ input }: { input: { resultSecretRegistry: ResolvedSecretTraceRegistry } }) => {
          input.resultSecretRegistry.markIncomplete('source-provenance-incomplete')
          return tool === 'search' ? { results: [document] } : document
        }
      )
      const result = await call(tool, tool === 'search' ? { query: 'release' } : { documentId })
      expect(result.isError).toBe(true)
      expect(result.content).toEqual([
        {
          type: 'text',
          text: 'Document secret provenance is unavailable. The content cannot be returned safely.',
        },
      ])
    }
  )
})

describe('batched document reads', () => {
  const readResult = (documentId: string) => ({
    documentId,
    knowledgeBaseId: '',
    knowledgeBaseName: 'Drive',
    documentName: documentId,
    sourceUrl: `https://example.com/${documentId}`,
    connectorType: 'google_drive',
    chunks: [],
    hasMore: false,
    next: null,
  })
  const parsedBody = (result: CallToolResult) => {
    const [part] = result.content
    if (part?.type !== 'text') throw new Error('Expected a text result')
    return JSON.parse(part.text) as { documents: Record<string, unknown>[] }
  }

  it('reports an unreadable document in its place and returns the others', async () => {
    create()
    mocks.liveRead.mockImplementation(async ({ input }: { input: { documentId: string } }) => {
      if (input.documentId === 'gone') throw new OrchestrationError('not_found', 'Document moved')
      if (input.documentId === 'broken') throw new Error('private backend detail')
      return readResult(input.documentId)
    })
    const result = await call('read_document', { documentIds: ['a', 'gone', 'broken', 'b'] })
    expect(result.isError).toBeUndefined()
    expect(parsedBody(result).documents).toEqual([
      expect.objectContaining({ documentId: 'a', title: 'a' }),
      { documentId: 'gone', error: 'Document moved' },
      { documentId: 'broken', error: 'Unable to read this document. Please try again.' },
      expect.objectContaining({ documentId: 'b', title: 'b' }),
    ])
  })

  it('charges the rate limit once per distinct document', async () => {
    create()
    mocks.liveRead.mockImplementation(async ({ input }: { input: { documentId: string } }) =>
      readResult(input.documentId)
    )
    await call('read_document', { documentIds: ['a', 'b', 'a'] })
    expect(mocks.rateLimit).toHaveBeenCalledWith(request, auth, expect.anything(), 2)
    expect(mocks.liveRead).toHaveBeenCalledTimes(2)
  })

  it('reads at most five documents from providers at once, in request order', async () => {
    create()
    let inFlight = 0
    let peak = 0
    mocks.liveRead.mockImplementation(async ({ input }: { input: { documentId: string } }) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      const laterFinishesFirst = 10 - Number(input.documentId.slice('doc-'.length))
      for (let tick = 0; tick < laterFinishesFirst; tick++) await Promise.resolve()
      inFlight--
      return readResult(input.documentId)
    })
    const ids = Array.from({ length: 10 }, (_, index) => `doc-${index}`)
    const result = await call('read_document', { documentIds: ids })
    expect(peak).toBe(5)
    expect(parsedBody(result).documents.map((document) => document.documentId)).toEqual(ids)
  })

  it('reads nothing when the batch exceeds the remaining rate limit', async () => {
    create()
    mocks.rateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }))
    expect((await call('read_document', { documentIds: ['a', 'b'] })).isError).toBe(true)
    expect(mocks.liveRead).not.toHaveBeenCalled()
  })

  it.each([
    [{ documentId: 'a', documentIds: ['b'] }],
    [{}],
    [{ documentIds: ['a'], startOffset: 8000 }],
  ])('rejects ambiguous read input %j', (input) => {
    create()
    expect(() => mocks.configs.get('read_document')?.inputSchema.parse(input)).toThrow()
  })
})

describe('organization Search MCP tools', () => {
  it('does not return content denied by the canonical document ACL operation', async () => {
    create()
    mocks.liveRead.mockRejectedValueOnce(new OrchestrationError('not_found', 'Document not found'))
    const result = await call('read_document', {
      documentId: 'foreign-document',
    })
    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Document not found' }],
    })
  })
  it('does not expose cached success after a later membership or policy denial', async () => {
    create()
    await call('search', { query: 'first', topK: 10 })
    mocks.liveSearch.mockRejectedValueOnce(
      new OrchestrationError('forbidden', 'Knowledge access is disabled')
    )
    expect((await call('search', { query: 'second', topK: 10 })).isError).toBe(true)
    expect(mocks.liveSearch).toHaveBeenCalledTimes(2)
  })

  it('does not return partial metadata when the chunk read is denied', async () => {
    create()
    mocks.liveRead.mockRejectedValueOnce(new OrchestrationError('not_found', 'Document not found'))
    expect(await call('read_document', { documentId: 'doc-1' })).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Document not found' }],
    })
  })
})

describe('organization chat', () => {
  it('exposes only the three organization Search tools', () => {
    create()
    expect([...mocks.tools.keys()]).toEqual(['search', 'read_document', 'chat'])
  })
  it('does not run when rate limited', async () => {
    create()
    mocks.rateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }))
    expect((await call('chat', { query: 'answer' })).isError).toBe(true)
    expect(mocks.chat).not.toHaveBeenCalled()
  })
  it('does not leak backend failures', async () => {
    create()
    mocks.chat.mockRejectedValueOnce(new Error('private backend detail'))
    const result = await call('chat', { query: 'answer' })
    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Unable to complete this operation. Please try again.' }],
    })
  })
})

describe('MCP tool completion records', () => {
  it('records a returned tool error as an error even though the HTTP transport can succeed', async () => {
    create()
    const result = await call('read_document', {})
    expect(result.isError).toBe(true)
    expect(getMockLogger('KnowledgeMcp').info).toHaveBeenCalledExactlyOnceWith(
      'Knowledge MCP tool completed',
      expect.objectContaining({ toolName: 'read_document', outcome: 'error' })
    )
  })

  it('records an authorization failure without including the query or error message', async () => {
    create()
    mocks.liveSearch.mockRejectedValueOnce(
      new OrchestrationError('forbidden', 'Private denial reason')
    )
    await call('search', { query: 'private query' })
    expect(getMockLogger('KnowledgeMcp').info).toHaveBeenCalledExactlyOnceWith(
      'Knowledge MCP tool completed',
      {
        toolName: 'search',
        operation: 'knowledge.search',
        organizationId: 'org-1',
        userId: 'person-1',
        outcome: 'error',
        durationMs: expect.any(Number),
      }
    )
  })
})
