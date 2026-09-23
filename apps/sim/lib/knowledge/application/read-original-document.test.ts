/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  permission: vi.fn(),
  download: vi.fn(),
  provenance: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  isOrgAdminRole: (role: string) => role === 'admin' || role === 'owner',
  permissionSatisfies: (actual: string | null) => actual !== null,
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveCanonicalActiveKnowledgeDocumentContext: mocks.context,
}))
vi.mock('@/lib/uploads/core/storage-service', () => ({ downloadFile: mocks.download }))
vi.mock('@/lib/knowledge/secret-provenance', () => ({
  createKnowledgeDocumentSourceValue: (doc: { filename: string; fileUrl: string }) => ({
    filename: doc.filename,
    fileUrl: doc.fileUrl,
  }),
  loadKnowledgeDocumentDurableSecretProvenance: mocks.provenance,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { readOriginalKnowledgeDocument } from '@/lib/knowledge/application/read-original-document'

const principal = { kind: 'session', userId: 'reader', sessionId: 'session' } as const
const document = {
  id: 'doc',
  filename: 'policy.md',
  fileUrl: 'data:text/markdown;base64,IyBQb2xpY3k=',
  storageKey: null,
  fileSize: 8,
  mimeType: 'text/markdown',
  enabled: true,
  processingStatus: 'failed',
}
const context = {
  workspaceId: 'workspace',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  knowledgeBaseId: 'kb',
  document,
}
const input = {
  knowledgeBaseId: 'kb',
  documentId: 'doc',
  assertedWorkspaceId: 'workspace',
  maxBytes: 64,
}
const run = () => readOriginalKnowledgeDocument.execute({ principal, input })

describe('original knowledge document read', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.context.mockResolvedValue(context)
    mocks.permission.mockResolvedValue('read')
    mocks.provenance.mockResolvedValue({
      source: { filename: document.filename, fileUrl: document.fileUrl },
      provenance: { status: 'exact', entries: [] },
    })
    mocks.download.mockResolvedValue(Buffer.from('# Policy'))
  })
  it.each(['failed', 'pending', 'completed'])(
    'reads a bounded original independently of %s indexing',
    async (processingStatus) => {
      mocks.context.mockResolvedValue({ ...context, document: { ...document, processingStatus } })
      const result = await run()
      expect(result).toMatchObject({
        sourceAvailable: true,
        indexReady: processingStatus === 'completed',
        buffer: Buffer.from('# Policy'),
      })
      expect(mocks.context).toHaveBeenCalledWith(input, principal)
      expect(mocks.download).not.toHaveBeenCalled()
    }
  )
  it('uses the canonical storage key and passes byte/cancellation limits', async () => {
    mocks.context.mockResolvedValue({
      ...context,
      document: { ...document, storageKey: 'kb/canonical-source' },
    })
    await run()
    expect(mocks.download).toHaveBeenCalledWith({
      key: 'kb/canonical-source',
      context: 'knowledge-base',
      maxBytes: 64,
      signal: undefined,
    })
  })
  it('reports no stored source without fetching an external URL', async () => {
    mocks.context.mockResolvedValue({
      ...context,
      document: {
        ...document,
        fileUrl: 'https://example.test/private',
        processingStatus: 'completed',
      },
    })
    mocks.provenance.mockResolvedValue({
      source: { filename: document.filename, fileUrl: 'https://example.test/private' },
      provenance: { status: 'exact', entries: [] },
    })
    expect(await run()).toMatchObject({
      indexReady: true,
      sourceAvailable: false,
      buffer: undefined,
    })
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.provenance).toHaveBeenCalledWith('doc')
  })
  it('distinguishes an absent source from a provider failure', async () => {
    mocks.context.mockResolvedValue({
      ...context,
      document: { ...document, storageKey: 'kb/source' },
    })
    mocks.download.mockRejectedValueOnce({ name: 'NoSuchKey' })
    expect(await run()).toMatchObject({ sourceAvailable: false })
    mocks.download.mockRejectedValueOnce(new Error('provider unavailable'))
    await expect(run()).rejects.toThrow('provider unavailable')
  })
  it('rechecks permission before reading source or provenance', async () => {
    mocks.permission.mockResolvedValue(null)
    await expect(run()).rejects.toThrow('Insufficient workspace')
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.provenance).not.toHaveBeenCalled()
  })
  it('conceals a document outside the canonical scope', async () => {
    mocks.context.mockRejectedValue(new OrchestrationError('not_found', 'Document not found'))
    await expect(run()).rejects.toThrow('Document not found')
    expect(mocks.download).not.toHaveBeenCalled()
  })
  it('bounds actual inline bytes even when stored metadata understates them', async () => {
    await expect(
      readOriginalKnowledgeDocument.execute({ principal, input: { ...input, maxBytes: 1 } })
    ).rejects.toThrow('byte limit')
    mocks.context.mockResolvedValue({ ...context, document: { ...document, fileSize: 1 } })
    await expect(
      readOriginalKnowledgeDocument.execute({ principal, input: { ...input, maxBytes: 1 } })
    ).rejects.toThrow(/limit/)
  })
  it.each([{ status: 'unknown' }, { status: 'exact', entries: [{ secret: 'private' }] }])(
    'refuses originals without secret-free provenance',
    async (provenance) => {
      mocks.provenance.mockResolvedValue({
        source: { filename: document.filename, fileUrl: document.fileUrl },
        provenance,
      })
      await expect(run()).rejects.toThrow('secret-free')
      expect(mocks.download).not.toHaveBeenCalled()
    }
  )
  it('refuses a concurrent source replacement before reading', async () => {
    mocks.provenance.mockResolvedValue({
      source: { filename: 'changed', fileUrl: document.fileUrl },
      provenance: { status: 'exact', entries: [] },
    })
    await expect(run()).rejects.toThrow('secret-free')
  })
})
