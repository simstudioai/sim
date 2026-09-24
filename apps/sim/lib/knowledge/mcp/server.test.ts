/** @vitest-environment node */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createMockLogger, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  tools: new Map<
    string,
    (input: Record<string, unknown>, extra: { signal: AbortSignal }) => Promise<CallToolResult>
  >(),
  configs: new Map<
    string,
    { description: string; inputSchema: { parse: (input: unknown) => unknown } }
  >(),
  search: vi.fn(),
  read: vi.fn(),
  liveSearch: vi.fn(),
  liveRead: vi.fn(),
  chat: vi.fn(),
  rateLimit: vi.fn(),
  info: vi.fn(),
  afterResponse: vi.fn<(task: () => Promise<void>) => void>(),
  recordActivity: vi.fn(),
}))
vi.mock('@/lib/core/utils/after-response', () => ({ afterResponse: mocks.afterResponse }))
vi.mock('@/lib/knowledge/mcp/activity', () => ({
  recordOrganizationSearchMcpActivity: mocks.recordActivity,
}))
vi.mock('@sim/logger', () => ({
  createLogger: () => ({ ...createMockLogger(), info: mocks.info }),
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
      mocks.tools.set(name, run)
      mocks.configs.set(name, config)
    }
  },
}))
vi.mock('@/lib/api/server/routes/v2-json-route', () => ({
  v2RateLimits: { publicApi: { enforce: mocks.rateLimit } },
}))
vi.mock('@/lib/knowledge/application/search', () => ({
  searchKnowledge: { execute: mocks.search },
}))
vi.mock('@/lib/sim-search/indexed', () => ({
  readIndexedKnowledgeDocument: { execute: mocks.read },
}))
vi.mock('@/lib/sim-search/live/application', () => ({
  searchLiveKnowledge: { execute: mocks.liveSearch },
  readLiveDocument: { execute: mocks.liveRead },
}))
vi.mock('@/lib/knowledge/application/chat', () => ({
  organizationSearchChat: { execute: mocks.chat },
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.example' }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { createKnowledgeMcpServer } from '@/lib/knowledge/mcp/server'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const principal = { kind: 'personal_api_key' as const, userId: 'person-1', keyId: 'key-1' }
const auth = {
  principal,
  keyType: 'personal' as const,
  keyExpiresAt: null,
  rateLimitSubjectIds: ['person-1'] as const,
  rateLimitSubscription: null,
}
const request = new NextRequest('http://localhost/api/mcp/search/organizations/org-1')
function create(searchIndexId: string | null = 'index-1') {
  createKnowledgeMcpServer({ organizationId: 'org-1', searchIndexId, request, auth })
}
function call(tool: string, input: Record<string, unknown>, signal = new AbortController().signal) {
  const run = mocks.tools.get(tool)
  if (!run) throw new Error(`Missing tool ${tool}`)
  return run(input, { signal })
}

function payload(result: CallToolResult): unknown {
  const first = result.content[0]
  if (first.type !== 'text') throw new Error('Expected a text result')
  return JSON.parse(first.text)
}

beforeEach(() => {
  vi.clearAllMocks()
  resetEnvFlagsMock()
  setEnvFlags({ isLiveEnterpriseSearchEnabled: false })
  mocks.tools.clear()
  mocks.configs.clear()
  mocks.rateLimit.mockReset().mockResolvedValue(null)
  mocks.search.mockResolvedValue({ results: [] })
  mocks.read.mockResolvedValue({
    knowledgeBaseId: 'index-1',
    documentId: 'doc-1',
    title: 'A source',
    sourceUrl: 'https://example.com/source',
    processingStatus: 'completed',
    chunks: [{ id: 'chunk-1', chunkIndex: 0, content: 'Indexed text' }],
    pagination: { total: 1, offset: 0, limit: 20, hasMore: false },
  })
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
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
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

  it('searches live without an index and preserves native pagination and the actual caller', async () => {
    create(null)
    const input = {
      query: 'release',
      source: 'google_drive',
      startDate: '2026-09-01T00:00:00Z',
      nativeQueries: [
        {
          provider: 'google_drive',
          query: "fullText contains 'release'",
          accountId: 'account-1',
          cursor: 'page-1',
        },
      ],
    }
    const result = await call('search', input)
    expect(result.isError).toBeUndefined()
    expect(payload(result)).toMatchObject({
      results: [
        {
          documentId,
          title: 'Release notes',
          citationId: expect.stringMatching(/^live:[a-f0-9]{32}$/),
          citationUrl: document.sourceUrl,
        },
      ],
      live: coverage,
    })
    expect(mocks.liveSearch).toHaveBeenCalledExactlyOnceWith({
      principal,
      request,
      input: {
        organizationId: 'org-1',
        query: input.query,
        topK: 20,
        nativeQueries: input.nativeQueries,
        filters: { source: input.source, startDate: input.startDate },
        resultSecretRegistry: expect.any(ResolvedSecretTraceRegistry),
        signal: expect.any(AbortSignal),
      },
    })
    expect(mocks.search).not.toHaveBeenCalled()
    expect(mocks.configs.get('search')?.description).not.toMatch(/index|similarity/)
    expect(mocks.configs.get('search')?.inputSchema.parse(input)).toMatchObject(input)
  })

  it('advertises and accepts long live references and exact read continuation', async () => {
    create()
    const input = { documentId, limit: 1, startChunkIndex: 0, startOffset: 8000 }
    expect(mocks.configs.get('read_document')?.inputSchema.parse(input)).toEqual(input)
    const result = await call('read_document', input)
    expect(result.isError).toBeUndefined()
    expect(mocks.liveRead).toHaveBeenCalledExactlyOnceWith({
      principal,
      request,
      input: {
        ...input,
        organizationId: 'org-1',
        resultSecretRegistry: expect.any(ResolvedSecretTraceRegistry),
        signal: expect.any(AbortSignal),
      },
    })
    expect(payload(result)).toMatchObject({
      documentId,
      citationUrl: document.sourceUrl,
      hasMore: true,
      next: { startChunkIndex: 0, startOffset: 16000 },
    })
    expect(payload(result)).not.toHaveProperty('knowledgeBaseId')
    expect(payload(result)).not.toHaveProperty('processingStatus')
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.configs.get('read_document')?.description).not.toMatch(/index/)
  })

  it('does not invent a knowledge-base link when a live result has no source URL', async () => {
    create()
    mocks.liveSearch.mockResolvedValueOnce({ results: [{ ...document, sourceUrl: null }] })
    expect(payload(await call('search', { query: 'release' }))).toMatchObject({
      results: [{ citationUrl: null }],
    })
  })

  it.each(['search', 'read_document'])(
    'does not fall back to indexed data after a live %s denial',
    async (tool) => {
      create()
      const backend = tool === 'search' ? mocks.liveSearch : mocks.liveRead
      backend.mockRejectedValueOnce(new OrchestrationError('forbidden', 'Access denied'))
      const result = await call(tool, tool === 'search' ? { query: 'release' } : { documentId })
      expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'Access denied' }] })
      expect(mocks.search).not.toHaveBeenCalled()
      expect(mocks.read).not.toHaveBeenCalled()
    }
  )

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

  it.each(['search', 'read_document'])(
    'stops cancelled live %s calls before provider access',
    async (tool) => {
      create()
      expect(
        (
          await call(
            tool,
            tool === 'search' ? { query: 'release' } : { documentId },
            AbortSignal.abort()
          )
        ).isError
      ).toBe(true)
      expect(mocks.liveSearch).not.toHaveBeenCalled()
      expect(mocks.liveRead).not.toHaveBeenCalled()
    }
  )
})

describe('search', () => {
  const tool = 'search'
  it('searches only the canonical index using the actual personal key principal', async () => {
    create()
    expect((await call(tool, { query: 'find it', topK: 10 })).isError).toBeUndefined()
    expect(mocks.search).toHaveBeenCalledWith({
      principal,
      request,
      input: expect.objectContaining({
        organizationId: 'org-1',
        knowledgeBaseIds: ['index-1'],
        query: 'find it',
        surface: 'mcp',
      }),
    })
  })
  it('returns an empty setup state when the organization has no index', async () => {
    create(null)
    const result = await call(tool, { query: 'find it', topK: 10 })
    expect(result.isError).toBeUndefined()
    expect(mocks.search).not.toHaveBeenCalled()
  })
})

describe('organization Search MCP tools', () => {
  it('delegates ID and context reads to the shared application operation', async () => {
    create()
    await call('read_document', { documentId: 'doc-1', limit: 5, aroundChunkIndex: 19 })
    expect(mocks.read).toHaveBeenCalledWith({
      principal,
      request,
      input: expect.objectContaining({
        organizationId: 'org-1',
        target: { kind: 'id', documentId: 'doc-1' },
        limit: 5,
        aroundChunkIndex: 19,
        offset: undefined,
      }),
    })
  })
  it('delegates URL resolution without fetching the URL in the adapter', async () => {
    create()
    await call('read_document', { url: 'https://example.com/source', limit: 20 })
    expect(mocks.read).toHaveBeenCalledWith({
      principal,
      request,
      input: expect.objectContaining({
        organizationId: 'org-1',
        target: { kind: 'url', url: 'https://example.com/source' },
      }),
    })
  })
  it('does not return content denied by the canonical document ACL operation', async () => {
    create()
    mocks.read.mockRejectedValueOnce(new OrchestrationError('not_found', 'Document not found'))
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
    mocks.search.mockRejectedValueOnce(
      new OrchestrationError('forbidden', 'Knowledge access is disabled')
    )
    expect((await call('search', { query: 'second', topK: 10 })).isError).toBe(true)
    expect(mocks.search).toHaveBeenCalledTimes(2)
  })

  it('returns metadata and enabled text through the existing authorized reads', async () => {
    create()
    const input = { documentId: 'doc-1', limit: 20, offset: 0 }
    const result = await call('read_document', input)
    expect(result.isError).toBeUndefined()
    expect(payload(result)).toMatchObject({
      documentId: input.documentId,
      title: 'A source',
      sourceUrl: 'https://example.com/source',
      processingStatus: 'completed',
      chunks: [{ id: 'chunk-1', chunkIndex: 0, content: 'Indexed text' }],
      pagination: { total: 1, offset: 0, limit: 20, hasMore: false },
    })
    expect(payload(result)).toMatchObject({
      citationId: 'document:doc-1',
      citationUrl: 'https://example.com/source',
    })
  })

  it.each(['pending', 'processing', 'failed'])(
    'preserves metadata for a %s document without presenting incomplete text',
    async (processingStatus) => {
      create()
      mocks.read.mockResolvedValueOnce({
        knowledgeBaseId: 'index-1',
        documentId: 'doc-1',
        title: 'A source',
        sourceUrl: null,
        processingStatus,
      })
      const result = await call('read_document', {
        documentId: 'doc-1',
      })
      expect(result.isError).toBeUndefined()
      expect(payload(result)).toMatchObject({ documentId: 'doc-1', processingStatus })
      expect(payload(result)).not.toHaveProperty('chunks')
      expect(payload(result)).not.toHaveProperty('pagination')
    }
  )

  it('does not return partial metadata when the chunk read is denied', async () => {
    create()
    mocks.read.mockRejectedValueOnce(new OrchestrationError('not_found', 'Document not found'))
    expect(await call('read_document', { documentId: 'doc-1' })).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Document not found' }],
    })
  })

  it.each(['read_document'])('stops cancelled %s calls before accessing data', async (tool) => {
    create()
    const result = await call(tool, { documentId: 'doc-1' }, AbortSignal.abort())
    expect(result.isError).toBe(true)
    expect(mocks.read).not.toHaveBeenCalled()
  })
})

describe('filters and citations', () => {
  it('forwards shared source, date, and document filters', async () => {
    create()
    const filters = {
      source: 'jira',
      modifiedAfter: '2026-09-07T00:00:00Z',
      documentIds: ['doc-1'],
    }
    await call('search', { query: 'updates', topK: 10, ...filters })
    expect(mocks.search).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ filters }) })
    )
  })
  it('includes a safe navigable citation even without a source URL', async () => {
    create()
    mocks.search.mockResolvedValueOnce({
      results: [
        {
          knowledgeBaseId: 'index-1',
          documentId: 'doc-1',
          sourceUrl: null,
          documentName: 'Notes',
          content: 'Evidence',
          chunkIndex: 2,
          similarity: 0.3,
        },
      ],
    })
    expect(payload(await call('search', { query: 'notes', topK: 10 }))).toMatchObject({
      results: [
        {
          citationId: 'document:doc-1',
          citationUrl: 'https://sim.example/o/org-1/knowledge/index-1/doc-1',
          chunkIndex: 2,
        },
      ],
    })
  })
})

describe('organization chat', () => {
  it('exposes only the three organization Search tools', () => {
    create()
    expect([...mocks.tools.keys()]).toEqual(['search', 'read_document', 'chat'])
  })
  it('uses the real caller and shared filters to ask the organization Assistant', async () => {
    create()
    const result = await call('chat', {
      query: 'What changed?',
      source: 'jira',
      modifiedAfter: '2026-09-07T00:00:00Z',
    })
    expect(payload(result)).toEqual({ content: 'An answer', citations: [] })
    expect(mocks.chat).toHaveBeenCalledWith({
      principal,
      input: expect.objectContaining({
        organizationId: 'org-1',
        query: 'What changed?',
        filters: { source: 'jira', modifiedAfter: '2026-09-07T00:00:00Z' },
      }),
    })
    expect(mocks.rateLimit).toHaveBeenCalledWith(
      request,
      auth,
      expect.objectContaining({ id: 'knowledge.chat', oauthScope: 'search:read' })
    )
  })
  it('stops cancelled calls before starting a conversation', async () => {
    create()
    expect((await call('chat', { query: 'answer' }, AbortSignal.abort())).isError).toBe(true)
    expect(mocks.chat).not.toHaveBeenCalled()
  })
  it('does not run when rate limited', async () => {
    create()
    mocks.rateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }))
    expect((await call('chat', { query: 'answer' })).isError).toBe(true)
    expect(mocks.chat).not.toHaveBeenCalled()
  })
  it('includes the actual retry delay in rate-limited tool results', async () => {
    create()
    mocks.rateLimit.mockResolvedValueOnce(
      new Response(null, { status: 429, headers: { 'Retry-After': '90' } })
    )
    expect(await call('chat', { query: 'answer' })).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'API rate limit exceeded. Retry in 90 seconds.' }],
    })
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
  it('schedules only metadata after the response, independently of analytics storage latency', async () => {
    createKnowledgeMcpServer({
      organizationId: 'org-1',
      searchIndexId: 'index-1',
      request,
      auth: {
        ...auth,
        keyType: 'oauth_access_token',
        principal: {
          kind: 'oauth_access_token',
          userId: 'oauth-person',
          clientId: 'registered-client',
          clientName: 'Registered app',
          tokenId: 'private-token-id',
          scopes: ['search:read'],
          expiresAt: new Date(Date.now() + 60000),
        },
      },
    })
    const response = await call('search', { query: 'private question' })
    expect(response.isError).not.toBe(true)
    expect(mocks.recordActivity).not.toHaveBeenCalled()
    expect(mocks.afterResponse).toHaveBeenCalledOnce()
    await mocks.afterResponse.mock.calls[0][0]()
    expect(mocks.recordActivity).toHaveBeenCalledExactlyOnceWith({
      organizationId: 'org-1',
      userId: 'oauth-person',
      authKind: 'oauth_access_token',
      oauthClientId: 'registered-client',
      clientName: 'Registered app',
      toolName: 'search',
      outcome: 'success',
      durationMs: expect.any(Number),
      createdAt: expect.any(Date),
    })
  })

  it.each([
    ['search', { query: 'private query', topK: 10 }, 'knowledge.search'],
    ['read_document', { documentId: 'doc-1' }, 'knowledge.documents.read'],
    ['chat', { query: 'private question' }, 'knowledge.chat'],
  ] as const)('records one content-free completion for %s', async (toolName, input, operation) => {
    create()
    await call(toolName, input)
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith('Knowledge MCP tool completed', {
      toolName,
      operation,
      organizationId: 'org-1',
      userId: 'person-1',
      outcome: 'success',
      durationMs: expect.any(Number),
    })
  })

  it('records a returned tool error as an error even though the HTTP transport can succeed', async () => {
    create()
    const result = await call('read_document', {})
    expect(result.isError).toBe(true)
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      'Knowledge MCP tool completed',
      expect.objectContaining({ toolName: 'read_document', outcome: 'error' })
    )
  })

  it('records an authorization failure without including the query or error message', async () => {
    create()
    mocks.search.mockRejectedValueOnce(new OrchestrationError('forbidden', 'Private denial reason'))
    await call('search', { query: 'private query' })
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith('Knowledge MCP tool completed', {
      toolName: 'search',
      operation: 'knowledge.search',
      organizationId: 'org-1',
      userId: 'person-1',
      outcome: 'error',
      durationMs: expect.any(Number),
    })
  })

  it('distinguishes rate limiting from an executed tool', async () => {
    create()
    mocks.rateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }))
    await call('search', { query: 'private query' })
    expect(mocks.search).not.toHaveBeenCalled()
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      'Knowledge MCP tool completed',
      expect.objectContaining({ outcome: 'rate_limited' })
    )
    await mocks.afterResponse.mock.calls[0][0]()
    expect(mocks.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        authKind: 'personal_api_key',
        oauthClientId: null,
        outcome: 'rate_limited',
      })
    )
  })

  it.each(['search', 'read_document', 'chat'])(
    'records cancelled %s calls without executing the operation',
    async (toolName) => {
      create()
      mocks.rateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }))
      await call(toolName, { query: 'private query', documentId: 'doc-1' }, AbortSignal.abort())
      expect(mocks.rateLimit).not.toHaveBeenCalled()
      expect(mocks.search).not.toHaveBeenCalled()
      expect(mocks.read).not.toHaveBeenCalled()
      expect(mocks.chat).not.toHaveBeenCalled()
      expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
        'Knowledge MCP tool completed',
        expect.objectContaining({ toolName, outcome: 'cancelled' })
      )
    }
  )

  it('records cancellation during rate-limit admission instead of an exhausted bucket', async () => {
    create()
    const controller = new AbortController()
    mocks.rateLimit.mockImplementationOnce(async () => {
      controller.abort()
      return new Response(null, { status: 429 })
    })
    await call('search', { query: 'private query' }, controller.signal)
    expect(mocks.search).not.toHaveBeenCalled()
    await mocks.afterResponse.mock.calls[0][0]()
    expect(mocks.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'cancelled' })
    )
  })
})
