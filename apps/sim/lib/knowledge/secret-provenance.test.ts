/**
 * @vitest-environment node
 */
import { document, embedding } from '@sim/db/schema'
import { dbChainMock, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbTransaction } from '@/lib/db/types'
import {
  type DurableSecretProvenance,
  hashDurableSecretProvenanceValue,
} from '@/lib/execution/durable-secret-provenance'
import {
  createKnowledgeDocumentSourceValue,
  importKnowledgePersistedResponseSecretProvenance,
  importKnowledgeSearchResultSecretProvenance,
  loadKnowledgeDocumentSecretRegistry,
  readBoundKnowledgeDocumentSecretProvenance,
  replaceKnowledgeDocumentSecretProvenanceInTx,
} from '@/lib/knowledge/secret-provenance'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const { mockDecryptSecret, mockIsEnforced, mockReport, mockReportWrite, mockReportRefusal } =
  vi.hoisted(() => ({
    mockDecryptSecret: vi.fn(),
    mockIsEnforced: vi.fn(() => false),
    mockReport: vi.fn(),
    mockReportWrite: vi.fn(),
    mockReportRefusal: vi.fn(),
  }))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: mockDecryptSecret,
}))

vi.mock('@/lib/execution/durable-secret-provenance-enforcement', () => ({
  isDurableSecretProvenanceEnforced: mockIsEnforced,
  reportUnrecordedDurableProvenance: mockReport,
  reportDurableSecretProvenanceWrite: mockReportWrite,
  reportDurableSecretProvenanceRefusal: mockReportRefusal,
}))

const DOCUMENT_SOURCE = createKnowledgeDocumentSourceValue({
  filename: 'source.pdf',
  fileUrl: '/api/files/serve/workspace%2Fworkspace-1%2Fsource.pdf?context=workspace',
})

const DOCUMENT_ROW = {
  id: 'document-1',
  ...DOCUMENT_SOURCE,
  secretProvenanceVersion: null,
  provenanceSourceHash: null,
  status: null,
  entries: null,
}

describe('knowledge durable secret provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    queueTableRows(document, [DOCUMENT_ROW])
    mockDecryptSecret.mockResolvedValue({ decrypted: 'tracked-secret' })
    mockIsEnforced.mockReturnValue(false)
  })

  it('uses the same explicit source shape for joined rows and persisted writes', () => {
    const source = createKnowledgeDocumentSourceValue({
      filename: 'file.txt',
      fileUrl: 'https://example.com/file.txt',
      sourceUrl: null,
      tag1: 'one',
      tag2: null,
      tag3: null,
      tag4: null,
      tag5: null,
      tag6: null,
      tag7: null,
    })
    const joinedRow = {
      ...source,
      secretProvenanceVersion: 1,
      provenanceSourceHash: hashDurableSecretProvenanceValue(source),
      status: 'exact',
      entries: [],
      unrelatedJoinedField: 'must-not-enter-the-hash',
    }

    const canonicalSource = createKnowledgeDocumentSourceValue(joinedRow)

    expect(canonicalSource).toEqual(source)
    expect(
      readBoundKnowledgeDocumentSecretProvenance({
        ...joinedRow,
        source: canonicalSource,
      })
    ).toEqual({ status: 'exact', entries: [] })

    expect(
      readBoundKnowledgeDocumentSecretProvenance({
        ...joinedRow,
        secretProvenanceVersion: null,
        provenanceSourceHash: 'stale',
        entries: [{ name: 'SECRET', encryptedValue: 'encrypted' }],
        source: { ...canonicalSource, filename: 'changed-by-old-app.txt' },
      })
    ).toEqual({ status: 'exact', entries: [] })
  })

  it('merges fresh source provenance into the pre-processing registry', async () => {
    const result = await loadKnowledgeDocumentSecretRegistry(
      DOCUMENT_ROW.id,
      { userId: 'source-user', workspaceId: 'workspace-1' },
      {
        status: 'exact',
        entries: [
          {
            name: 'OCR_SECRET',
            encryptedValue: 'encrypted-secret',
            sourceUserId: 'source-user',
            sourceWorkspaceId: 'workspace-1',
          },
        ],
      }
    )

    expect(result.tracked).toBe(true)
    expect(result.registry?.getActiveMatches()).toContainEqual(
      expect.objectContaining({ plaintext: 'tracked-secret' })
    )
  })

  it('fails closed when the fresh source classification is unknown', async () => {
    await expect(
      loadKnowledgeDocumentSecretRegistry(
        DOCUMENT_ROW.id,
        { userId: 'source-user', workspaceId: 'workspace-1' },
        { status: 'unknown' }
      )
    ).rejects.toThrow('Knowledge document secret provenance is unavailable')
    expect(mockReportRefusal).toHaveBeenCalledWith({
      surface: 'knowledge',
      cause: 'knowledge-document-source-unavailable',
      workspaceId: 'workspace-1',
      resourceId: DOCUMENT_ROW.id,
    })
  })

  it.each([
    [{ status: 'unknown' }, 'source-provenance-unknown'],
    [{ status: 'exact', entries: [{ encryptedValue: '' }] }, 'invalid-provenance-entries'],
  ] satisfies [DurableSecretProvenance, string][])(
    'reports a non-exact document write without source values',
    async (provenance, cause) => {
      await replaceKnowledgeDocumentSecretProvenanceInTx(
        dbChainMock.db as unknown as DbTransaction,
        DOCUMENT_ROW.id,
        DOCUMENT_SOURCE,
        provenance
      )
      expect(mockReportWrite).toHaveBeenCalledExactlyOnceWith({
        surface: 'knowledge',
        status: 'unknown',
        cause,
        resourceId: DOCUMENT_ROW.id,
      })
    }
  )

  it('does not report an exact-empty document write as a writer failure', async () => {
    await replaceKnowledgeDocumentSecretProvenanceInTx(
      dbChainMock.db as unknown as DbTransaction,
      DOCUMENT_ROW.id,
      DOCUMENT_SOURCE,
      { status: 'exact', entries: [] }
    )
    expect(mockReportWrite).not.toHaveBeenCalled()
  })

  it('marks a fresh exact-empty source as tracked without creating a registry', async () => {
    const result = await loadKnowledgeDocumentSecretRegistry(
      DOCUMENT_ROW.id,
      { userId: 'source-user', workspaceId: 'workspace-1' },
      { status: 'exact', entries: [] }
    )

    expect(result).toEqual({
      provenance: { status: 'exact', entries: [] },
      tracked: true,
    })
  })
})

describe('knowledge unrecorded-read reporting', () => {
  const SCOPE = { userId: 'user-1', workspaceId: 'workspace-1' }
  const UNRECORDED_DOCUMENT_ROW = {
    id: 'doc-1',
    ...DOCUMENT_SOURCE,
    secretProvenanceVersion: 1,
    provenanceSourceHash: null,
    status: 'unknown',
    entries: null,
  }
  const UNRECORDED_CHUNK_ROW = {
    id: 'chunk-1',
    documentId: 'doc-1',
    content: 'chunk text',
    chunkHash: 'stale',
    secretProvenanceVersion: 1,
    provenanceContentHash: null,
    status: 'unknown',
    entries: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsEnforced.mockReturnValue(false)
  })

  it('reports one aggregated entry per read, naming workspace, actor, and count', async () => {
    queueTableRows(document, [UNRECORDED_DOCUMENT_ROW])
    queueTableRows(embedding, [UNRECORDED_CHUNK_ROW])
    const registry = new ResolvedSecretTraceRegistry([], SCOPE)

    await expect(
      importKnowledgePersistedResponseSecretProvenance({
        registry,
        documents: [{ id: 'doc-1', source: DOCUMENT_SOURCE, value: {} }],
        chunks: [{ id: 'chunk-1', documentId: 'doc-1', content: 'chunk text', value: {} }],
        workspaceId: 'workspace-1',
        actorUserId: 'user-1',
      })
    ).resolves.toBe(true)

    expect(registry.isPermanentlyIncomplete()).toBe(false)
    expect(mockReport).toHaveBeenCalledTimes(1)
    expect(mockReport).toHaveBeenCalledWith({
      surface: 'knowledge',
      cause: 'durable-provenance-unknown',
      affectedCount: 2,
      workspaceId: 'workspace-1',
      actorUserId: 'user-1',
    })
  })

  /** A fault return fails the read closed, so no unvouched record reached anything to report. */
  it('reports nothing when the read fails closed on a missing row', async () => {
    queueTableRows(document, [])
    const registry = new ResolvedSecretTraceRegistry([], SCOPE)

    await expect(
      importKnowledgePersistedResponseSecretProvenance({
        registry,
        documents: [{ id: 'doc-1', source: DOCUMENT_SOURCE, value: {} }],
        workspaceId: 'workspace-1',
        actorUserId: 'user-1',
      })
    ).resolves.toBe(false)

    expect(mockReport).not.toHaveBeenCalled()
  })

  it('latches without reporting once the surface is enforced', async () => {
    mockIsEnforced.mockReturnValue(true)
    queueTableRows(document, [UNRECORDED_DOCUMENT_ROW])
    const registry = new ResolvedSecretTraceRegistry([], SCOPE)

    await expect(
      importKnowledgePersistedResponseSecretProvenance({
        registry,
        documents: [{ id: 'doc-1', source: DOCUMENT_SOURCE, value: {} }],
        workspaceId: 'workspace-1',
        actorUserId: 'user-1',
      })
    ).resolves.toBe(false)

    expect(registry.isPermanentlyIncomplete()).toBe(true)
    expect(mockReport).not.toHaveBeenCalled()
  })

  /** The search read spans chunks and rendered metadata, so its caller owns the one report. */
  it('returns the unrecorded count from a search import instead of reporting it', async () => {
    queueTableRows(embedding, [{ ...UNRECORDED_CHUNK_ROW, documentId: DOCUMENT_ROW.id }])
    queueTableRows(document, [DOCUMENT_ROW])
    const registry = new ResolvedSecretTraceRegistry([], SCOPE)

    const snapshot = await importKnowledgeSearchResultSecretProvenance({
      registry,
      results: [{ id: 'chunk-1', documentId: DOCUMENT_ROW.id, content: 'chunk text' }],
    })

    expect(snapshot.imported).toBe(true)
    expect(snapshot.unrecordedCount).toBe(1)
    expect(mockReport).not.toHaveBeenCalled()
  })
})
