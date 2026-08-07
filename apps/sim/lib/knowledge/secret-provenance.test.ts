/**
 * @vitest-environment node
 */
import { document } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hashDurableSecretProvenanceValue } from '@/lib/execution/durable-secret-provenance'
import {
  createKnowledgeDocumentSourceValue,
  loadKnowledgeDocumentSecretRegistry,
  readBoundKnowledgeDocumentSecretProvenance,
} from '@/lib/knowledge/secret-provenance'

const { mockDecryptSecret } = vi.hoisted(() => ({
  mockDecryptSecret: vi.fn(),
}))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: mockDecryptSecret,
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
