/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/search/search-index', () => ({
  findWorkspaceSearchIndex: async () => ({ id: 'index' }),
}))
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  permission: vi.fn(),
  chunks: vi.fn(),
  provenance: vi.fn(),
  importProvenance: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null) => actual !== null,
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveCanonicalActiveKnowledgeDocumentContext: mocks.context,
}))
vi.mock('@/lib/knowledge/chunks/service', () => ({ queryChunks: mocks.chunks }))
vi.mock('@/lib/knowledge/secret-provenance', () => ({
  importKnowledgeSearchResultSecretProvenance: mocks.provenance,
}))
vi.mock('@/lib/execution/durable-secret-provenance', () => ({
  importDurableSecretProvenance: mocks.importProvenance,
}))

import { readSearchDocument } from '@/lib/knowledge/application/read-search-document'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const principal = { kind: 'session', userId: 'reader', sessionId: 'session' } as const
const access = { kind: 'user', workspaceId: 'workspace', tokens: ['u:reader'] } as const
const context = {
  workspaceId: 'workspace',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'payer',
  knowledgeBaseId: 'index',
  knowledgeBase: { isSearchIndex: true },
  documentId: 'doc',
  document: {
    enabled: true,
    processingStatus: 'completed',
    filename: 'Title',
    sourceUrl: 'https://source.test/doc',
  },
  access: { get: async () => access },
}
const input = {
  documentId: 'doc',
  assertedWorkspaceId: 'workspace',
  offset: 0,
  limit: 20,
  filters: { source: 'slack', documentIds: ['doc'] },
  resultSecretRegistry: new ResolvedSecretTraceRegistry([], {
    userId: 'reader',
    workspaceId: 'workspace',
  }),
}
describe('Assistant document read', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.permission.mockResolvedValue('read')
    mocks.context.mockResolvedValue(context)
    mocks.chunks.mockResolvedValue({
      chunks: [{ id: 'chunk', chunkIndex: 0, content: 'body' }],
      pagination: { total: 1, hasMore: false },
    })
    mocks.provenance.mockResolvedValue({
      imported: true,
      documentMetadata: {
        doc: {
          filename: 'Title',
          sourceUrl: 'https://source.test/doc',
          provenance: { status: 'exact', entries: [] },
        },
      },
    })
    mocks.importProvenance.mockResolvedValue(true)
  })
  it('uses canonical authorization and filters enabled chunks by the same scope', async () => {
    await expect(readSearchDocument.execute({ principal, input })).resolves.toMatchObject({
      documentId: 'doc',
      chunks: [{ content: 'body', chunkIndex: 0 }],
      nextOffset: null,
    })
    expect(mocks.context).toHaveBeenCalledWith({ ...input, knowledgeBaseId: 'index' }, principal)
    expect(mocks.chunks).toHaveBeenCalledWith(
      'doc',
      expect.objectContaining({
        documentFilters: input.filters,
        enabled: 'true',
        offset: 0,
        limit: 20,
      }),
      expect.any(String),
      access
    )
  })
  it('rejects ordinary KBs and disabled documents', async () => {
    mocks.context.mockResolvedValueOnce({ ...context, knowledgeBase: { isSearchIndex: false } })
    await expect(readSearchDocument.execute({ principal, input })).rejects.toThrow(
      'Document not found'
    )
    mocks.context.mockResolvedValueOnce({
      ...context,
      document: { ...context.document, enabled: false },
    })
    await expect(readSearchDocument.execute({ principal, input })).rejects.toThrow(
      'Document not found'
    )
    expect(mocks.chunks).not.toHaveBeenCalled()
  })
  it('fails closed on absent filtered documents or unverified provenance', async () => {
    mocks.chunks.mockResolvedValueOnce({ chunks: [], pagination: { total: 0, hasMore: false } })
    await expect(readSearchDocument.execute({ principal, input })).rejects.toThrow(
      'Document not found'
    )
    mocks.provenance.mockResolvedValueOnce({ imported: false })
    await expect(readSearchDocument.execute({ principal, input })).rejects.toThrow('provenance')
  })
  it('rechecks the current workspace role', async () => {
    mocks.permission.mockResolvedValue(null)
    await expect(readSearchDocument.execute({ principal, input })).rejects.toThrow(
      'Insufficient workspace'
    )
    expect(mocks.chunks).not.toHaveBeenCalled()
  })
})
