import { document, embedding } from '@sim/db/schema'
import { dbChainMock, queueTableRows, resetDbChainMock } from '@sim/testing'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbTransaction } from '@/lib/db/types'
import type { DurableSecretProvenance } from '@/lib/execution/durable-secret-provenance'
import {
  classifyKnowledgeDocumentMetadata,
  createKnowledgeDocumentSourceValue,
  importKnowledgePersistedResponseSecretProvenance,
  importKnowledgeSearchResultSecretProvenance,
  knowledgeDocumentSnapshot,
  loadKnowledgeDocumentSecretRegistry,
  replaceKnowledgeDocumentSecretProvenanceInTx,
} from '@/lib/knowledge/secret-provenance'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const mockDecryptSecret = encryptionMockFns.mockDecryptSecret

const { mockReportWrite, mockReportRefusal } = vi.hoisted(() => ({
  mockReportWrite: vi.fn(),
  mockReportRefusal: vi.fn(),
}))

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

vi.mock('@/lib/execution/durable-secret-provenance-telemetry', () => ({
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
    resetDbChainMock()
    queueTableRows(document, [DOCUMENT_ROW])
    mockDecryptSecret.mockResolvedValue({ decrypted: 'tracked-secret' })
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
})

describe('knowledge durable provenance enforcement', () => {
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
    resetDbChainMock()
  })

  it('refuses unknown document provenance in a mixed persisted response', async () => {
    queueTableRows(document, [UNRECORDED_DOCUMENT_ROW])
    queueTableRows(embedding, [UNRECORDED_CHUNK_ROW])
    const registry = new ResolvedSecretTraceRegistry([], SCOPE)

    await expect(
      importKnowledgePersistedResponseSecretProvenance({
        registry,
        documents: [{ id: 'doc-1', source: DOCUMENT_SOURCE, value: {} }],
        chunks: [{ id: 'chunk-1', documentId: 'doc-1', content: 'chunk text', value: {} }],
      })
    ).resolves.toBe(false)

    expect(registry.isPermanentlyIncomplete()).toBe(true)
  })

  it('refuses missing persisted rows', async () => {
    queueTableRows(document, [])
    const registry = new ResolvedSecretTraceRegistry([], SCOPE)

    await expect(
      importKnowledgePersistedResponseSecretProvenance({
        registry,
        documents: [{ id: 'doc-1', source: DOCUMENT_SOURCE, value: {} }],
      })
    ).resolves.toBe(false)
  })

  it('refuses unknown document provenance', async () => {
    queueTableRows(document, [UNRECORDED_DOCUMENT_ROW])
    const registry = new ResolvedSecretTraceRegistry([], SCOPE)

    await expect(
      importKnowledgePersistedResponseSecretProvenance({
        registry,
        documents: [{ id: 'doc-1', source: DOCUMENT_SOURCE, value: {} }],
      })
    ).resolves.toBe(false)

    expect(registry.isPermanentlyIncomplete()).toBe(true)
  })

  it('refuses unrecorded chunks during a search import', async () => {
    queueTableRows(embedding, [{ ...UNRECORDED_CHUNK_ROW, documentId: DOCUMENT_ROW.id }])
    queueTableRows(document, [DOCUMENT_ROW])
    const registry = new ResolvedSecretTraceRegistry([], SCOPE)

    const snapshot = await importKnowledgeSearchResultSecretProvenance({
      registry,
      results: [{ id: 'chunk-1', documentId: DOCUMENT_ROW.id, content: 'chunk text' }],
    })

    expect(snapshot.imported).toBe(false)
    expect(registry.isPermanentlyIncomplete()).toBe(true)
  })
})

describe('document metadata classification bound to the shown snapshot', () => {
  const NUMBERED_ROW = { ...DOCUMENT_ROW, tag1: 'emea', number1: 42 }

  beforeEach(() => {
    resetDbChainMock()
  })

  it('keeps the stored classification while the shown metadata is what is stored', async () => {
    queueTableRows(document, [NUMBERED_ROW])
    const result = await classifyKnowledgeDocumentMetadata(
      [NUMBERED_ROW.id],
      new Map([[NUMBERED_ROW.id, [{ filename: 'source.pdf', tag1: 'emea', number1: '42' }]]])
    )
    expect(result.get(NUMBERED_ROW.id)?.status).toBe('exact')
  })

  it.each([
    ['a renamed document', { filename: 'previous-name.pdf' }],
    ['an edited tag', { tag1: 'previous value' }],
    ['a tag cleared since', { tag2: 'previous value' }],
    ['an edited number', { number1: '7' }],
  ])(
    'reads %s as unknown, so stale values are not paired with new provenance',
    async (_, shown) => {
      queueTableRows(document, [NUMBERED_ROW])
      const result = await classifyKnowledgeDocumentMetadata(
        [NUMBERED_ROW.id],
        new Map([[NUMBERED_ROW.id, [shown]]])
      )
      expect(result.get(NUMBERED_ROW.id)).toEqual({ status: 'unknown' })
    }
  )

  it('picks only the editable metadata a returned value shows', () => {
    expect(
      knowledgeDocumentSnapshot({
        id: 'd',
        filename: 'f.pdf',
        tag3: 'x',
        fileUrl: '/u',
        date1: 'd',
      })
    ).toEqual({ filename: 'f.pdf', tag3: 'x' })
    expect(knowledgeDocumentSnapshot({ id: 'd', fileUrl: '/u' })).toBeUndefined()
  })
})
