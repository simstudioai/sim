/** @vitest-environment node */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  tools: new Map<
    string,
    (input: Record<string, unknown>, extra: { signal: AbortSignal }) => Promise<CallToolResult>
  >(),
  search: vi.fn(),
  read: vi.fn(),
  chat: vi.fn(),
  rateLimit: vi.fn(),
}))
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    registerTool(
      name: string,
      _config: unknown,
      run: (
        input: Record<string, unknown>,
        extra: { signal: AbortSignal }
      ) => Promise<CallToolResult>
    ) {
      mocks.tools.set(name, run)
    }
  },
}))
vi.mock('@/lib/api/server/routes/v2-json-route', () => ({
  v2RateLimits: { publicApi: { enforce: mocks.rateLimit } },
}))
vi.mock('@/lib/knowledge/application/search', () => ({
  searchKnowledge: { execute: mocks.search },
}))
vi.mock('@/lib/knowledge/application/read-indexed-document', () => ({
  readIndexedKnowledgeDocument: { execute: mocks.read },
}))
vi.mock('@/lib/knowledge/application/chat', () => ({
  organizationSearchChat: { execute: mocks.chat },
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.example' }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { createKnowledgeMcpServer } from '@/lib/knowledge/mcp/server'

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
  mocks.tools.clear()
  mocks.rateLimit.mockResolvedValue(null)
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
