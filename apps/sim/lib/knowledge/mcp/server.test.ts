import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import {
  knowledgeSearchUseCaseMock,
  knowledgeSearchUseCaseMockFns,
} from '@sim/testing/mocks/knowledge-search-use-case.mock'
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
  read: vi.fn(),
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
  v2RateLimits: { publicApi: { enforce: hoisted.rateLimit } },
}))
vi.mock('@/lib/knowledge/application/search', () => knowledgeSearchUseCaseMock)
vi.mock('@/lib/knowledge/application/read-indexed-document', () => ({
  readIndexedKnowledgeDocument: { execute: hoisted.read },
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

const mocks = {
  ...hoisted,
  search: knowledgeSearchUseCaseMockFns.mockSearchKnowledgeExecute,
}

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
function create(searchIndexId: string | null = 'index-1') {
  createKnowledgeMcpServer({ organizationId: 'org-1', searchIndexId, request, auth })
}
function call(tool: string, input: Record<string, unknown>, signal = new AbortController().signal) {
  const run = mocks.tools.get(tool)
  if (!run) throw new Error(`Missing tool ${tool}`)
  return run(input, { signal })
}

function _payload(result: CallToolResult): unknown {
  const first = result.content[0]
  if (first.type !== 'text') throw new Error('Expected a text result')
  return JSON.parse(first.text)
}

beforeEach(() => {
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
})

describe('organization Search MCP tools', () => {
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

  it('does not return partial metadata when the chunk read is denied', async () => {
    create()
    mocks.read.mockRejectedValueOnce(new OrchestrationError('not_found', 'Document not found'))
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
    mocks.search.mockRejectedValueOnce(new OrchestrationError('forbidden', 'Private denial reason'))
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
