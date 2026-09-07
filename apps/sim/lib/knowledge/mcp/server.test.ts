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
  chunks: vi.fn(),
  rateLimit: vi.fn(),
  provenance: vi.fn(),
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
vi.mock('@/lib/knowledge/application/documents', () => ({
  readKnowledgeDocument: { execute: mocks.read },
}))
vi.mock('@/lib/knowledge/application/chunks', () => ({
  listKnowledgeChunks: { execute: mocks.chunks },
}))
vi.mock('@/lib/knowledge/secret-provenance', () => ({
  createKnowledgeDocumentSourceValue: (value: unknown) => value,
  importKnowledgePersistedResponseSecretProvenance: mocks.provenance,
}))

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
function call(tool: string, input: Record<string, unknown>) {
  const run = mocks.tools.get(tool)
  if (!run) throw new Error(`Missing tool ${tool}`)
  return run(input, { signal: new AbortController().signal })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.tools.clear()
  mocks.rateLimit.mockResolvedValue(null)
  mocks.search.mockResolvedValue({ results: [] })
  mocks.read.mockResolvedValue({
    document: {
      id: 'doc-1',
      filename: 'A source',
      sourceUrl: 'https://example.com/source',
      processingStatus: 'completed',
    },
  })
  mocks.chunks.mockResolvedValue({
    chunks: [{ id: 'chunk-1', chunkIndex: 0, content: 'Indexed text' }],
    pagination: { hasMore: false },
  })
})

describe('organization Search MCP tools', () => {
  it('searches only the canonical index using the actual personal key principal', async () => {
    create()
    expect((await call('search_documents', { query: 'find it', topK: 10 })).isError).toBeUndefined()
    expect(mocks.search).toHaveBeenCalledWith({
      principal,
      request,
      input: expect.objectContaining({
        organizationId: 'org-1',
        workspaceId: undefined,
        knowledgeBaseIds: ['index-1'],
        query: 'find it',
        surface: 'mcp',
      }),
    })
  })
  it('refuses arbitrary knowledge bases before any search', async () => {
    create()
    expect(
      (
        await call('search_documents', {
          query: 'find it',
          topK: 10,
          knowledgeBaseIds: ['index-1', 'other-index'],
        })
      ).isError
    ).toBe(true)
    expect(mocks.search).not.toHaveBeenCalled()
  })
  it('returns an empty setup state when the organization has no index', async () => {
    create(null)
    const result = await call('search_documents', { query: 'find it', topK: 10 })
    expect(result.isError).toBeUndefined()
    expect(mocks.search).not.toHaveBeenCalled()
  })
  it.each(['read_document', 'list_document_chunks'])(
    'refuses cross-index %s before loading data',
    async (tool) => {
      create()
      expect(
        (await call(tool, { knowledgeBaseId: 'other-index', documentId: 'doc-1' })).isError
      ).toBe(true)
      expect(mocks.read).not.toHaveBeenCalled()
      expect(mocks.chunks).not.toHaveBeenCalled()
    }
  )
  it.each(['read_document', 'list_document_chunks'])(
    'passes asserted organization scope to canonical %s',
    async (tool) => {
      create()
      expect(
        (
          await call(tool, {
            knowledgeBaseId: 'index-1',
            documentId: 'doc-1',
            limit: 20,
            offset: 0,
          })
        ).isError
      ).toBeUndefined()
      const useCase = tool === 'read_document' ? mocks.read : mocks.chunks
      expect(useCase).toHaveBeenCalledWith({
        principal,
        request,
        input: expect.objectContaining({
          assertedOrganizationId: 'org-1',
          assertedWorkspaceId: undefined,
          knowledgeBaseId: 'index-1',
          documentId: 'doc-1',
        }),
      })
      expect(mocks.provenance).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: 'person-1', workspaceId: undefined })
      )
    }
  )
  it('does not return content denied by the canonical document ACL operation', async () => {
    create()
    mocks.read.mockRejectedValueOnce(new OrchestrationError('not_found', 'Document not found'))
    const result = await call('read_document', {
      knowledgeBaseId: 'index-1',
      documentId: 'foreign-document',
    })
    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Document not found' }],
    })
    expect(mocks.provenance).not.toHaveBeenCalled()
  })
  it('does not expose cached success after a later membership or policy denial', async () => {
    create()
    await call('search_documents', { query: 'first', topK: 10 })
    mocks.search.mockRejectedValueOnce(
      new OrchestrationError('forbidden', 'Knowledge access is disabled')
    )
    expect((await call('search_documents', { query: 'second', topK: 10 })).isError).toBe(true)
    expect(mocks.search).toHaveBeenCalledTimes(2)
  })
})
