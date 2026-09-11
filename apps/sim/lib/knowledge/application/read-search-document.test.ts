/** @vitest-environment node */
import { member } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/search/search-index', () => ({
  findSearchIndex: async () => ({ id: 'index' }),
}))
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  permission: vi.fn(),
  chunks: vi.fn(),
  provenance: vi.fn(),
  importProvenance: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  isOrgAdminRole: (role: string) => role === 'admin' || role === 'owner',
  permissionSatisfies: (actual: string | null) => actual !== null,
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: async () => null,
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
  limit: 3,
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
      next: null,
    })
    expect(mocks.context).toHaveBeenCalledWith({ ...input, knowledgeBaseId: 'index' }, principal)
    expect(mocks.chunks).toHaveBeenCalledWith(
      'doc',
      expect.objectContaining({
        documentFilters: input.filters,
        enabled: 'true',
        limit: 3,
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

describe('organization Search document reads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.context.mockResolvedValue({
      ...context,
      workspaceId: undefined,
      organizationId: 'org-1',
      knowledgeBase: { isSearchIndex: true, organizationId: 'org-1' },
    })
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
  const orgInput = { ...input, assertedWorkspaceId: undefined, assertedOrganizationId: 'org-1' }
  it('uses the current org member and existing ACL-filtered document read pipeline', async () => {
    queueTableRows(member, [{ role: 'member' }])
    await expect(readSearchDocument.execute({ principal, input: orgInput })).resolves.toMatchObject(
      { documentId: 'doc', chunks: [{ content: 'body' }] }
    )
    expect(mocks.chunks).toHaveBeenCalledWith(
      'doc',
      expect.objectContaining({ enabled: 'true', documentFilters: orgInput.filters }),
      expect.any(String),
      access
    )
    expect(mocks.permission).not.toHaveBeenCalled()
  })
  it('refuses a removed member before reading document content or importing provenance', async () => {
    queueTableRows(member, [])
    await expect(readSearchDocument.execute({ principal, input: orgInput })).rejects.toThrow(
      'Organization not found'
    )
    expect(mocks.chunks).not.toHaveBeenCalled()
    expect(mocks.provenance).not.toHaveBeenCalled()
  })
  it('rejects ambiguous workspace and organization scope before canonical lookup', async () => {
    await expect(
      readSearchDocument.execute({
        principal,
        input: { ...orgInput, assertedWorkspaceId: 'workspace' },
      })
    ).rejects.toThrow('exactly one')
    expect(mocks.context).not.toHaveBeenCalled()
    expect(mocks.chunks).not.toHaveBeenCalled()
  })
})

describe('precise bounded passage expansion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.permission.mockResolvedValue('read')
    mocks.context.mockResolvedValue(context)
    mocks.provenance.mockResolvedValue({ imported: true, documentMetadata: {} })
  })

  it('projects a secret spanning the page boundary before slicing it', async () => {
    const secret = 'private-token-that-crosses-the-boundary'
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: secret, encryptedValue: 'ciphertext' },
    ])
    mocks.provenance.mockImplementationOnce(async () => {
      registry.recordResolved('TOKEN', secret)
      return { imported: true, documentMetadata: {} }
    })
    mocks.chunks.mockResolvedValue({
      chunks: [{ id: 'secret-chunk', chunkIndex: 0, content: `${'x'.repeat(7990) + secret}tail` }],
      pagination: { total: 1, hasMore: false },
    })
    const result = await readSearchDocument.execute({
      principal,
      input: { ...input, resultSecretRegistry: registry },
    })
    expect(result.chunks[0].content).toContain('{{TOKEN}}')
    expect(JSON.stringify(result)).not.toContain('private-token')
  })

  it('continues a long chunk before advancing across disabled chunk gaps', async () => {
    const content = 'Evidence 🔎\n'.repeat(1100)
    mocks.chunks.mockResolvedValue({
      chunks: [
        { id: 'c7', chunkIndex: 7, content },
        { id: 'c11', chunkIndex: 11, content: 'next enabled passage' },
      ],
      pagination: { total: 2, hasMore: false },
    })
    const first = await readSearchDocument.execute({
      principal,
      input: { ...input, startChunkIndex: 7 },
    })
    expect(first.chunks).toHaveLength(1)
    expect(first.chunks[0].content.length).toBeLessThanOrEqual(8000)
    expect(first.next).toEqual({ startChunkIndex: 7, startOffset: first.chunks[0].endOffset })
    const second = await readSearchDocument.execute({
      principal,
      input: { ...input, ...first.next! },
    })
    expect(first.chunks[0].content + second.chunks[0].content).toBe(content)
    expect(second.chunks[1].chunkIndex).toBe(11)
    expect(second.next).toBeNull()
    expect(mocks.chunks).toHaveBeenCalledWith(
      'doc',
      expect.objectContaining({ startChunkIndex: 7, requireEnabledDocument: true }),
      expect.any(String),
      access
    )
  })

  it('rejects positions without an anchor and stale within-chunk continuation', async () => {
    await expect(
      readSearchDocument.execute({ principal, input: { ...input, startOffset: 2 } })
    ).rejects.toThrow('startOffset requires startChunkIndex')
    expect(mocks.chunks).not.toHaveBeenCalled()
    mocks.chunks.mockResolvedValue({
      chunks: [{ id: 'c8', chunkIndex: 8, content: 'replacement' }],
      pagination: { total: 1, hasMore: false },
    })
    await expect(
      readSearchDocument.execute({
        principal,
        input: { ...input, startChunkIndex: 7, startOffset: 100 },
      })
    ).rejects.toThrow('no longer available')
  })
})
