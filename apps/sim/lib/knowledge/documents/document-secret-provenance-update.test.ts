/**
 * @vitest-environment node
 */
import { document, documentSecretProvenance } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hashDurableSecretProvenanceValue } from '@/lib/execution/durable-secret-provenance'
import { updateDocument } from '@/lib/knowledge/documents/service'
import {
  bindKnowledgeDocumentFieldSecretProvenance,
  createKnowledgeDocumentSourceValue,
} from '@/lib/knowledge/secret-provenance'

const UPLOADED_AT = new Date('2026-08-05T00:00:00.000Z')

const CURRENT_DOCUMENT = {
  id: 'document-1',
  knowledgeBaseId: 'knowledge-base-1',
  filename: 'before.txt',
  fileUrl: 'data:text/plain;base64,YmVmb3Jl',
  fileSize: 6,
  mimeType: 'text/plain',
  chunkCount: 1,
  tokenCount: 1,
  characterCount: 6,
  processingStatus: 'completed',
  processingStartedAt: null,
  processingCompletedAt: null,
  processingError: null,
  enabled: true,
  uploadedAt: UPLOADED_AT,
  tag1: null,
  tag2: null,
  tag3: null,
  tag4: null,
  tag5: null,
  tag6: null,
  tag7: null,
  number1: null,
  number2: null,
  number3: null,
  number4: null,
  number5: null,
  date1: null,
  date2: null,
  boolean1: null,
  boolean2: null,
  boolean3: null,
  contentHash: null,
  sourceUrl: null,
  deletedAt: null,
  secretProvenanceVersion: 1,
}

describe('knowledge document provenance updates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('rebinds a tracked source after the demotion trigger returns a NULL marker', async () => {
    const currentSource = createKnowledgeDocumentSourceValue(CURRENT_DOCUMENT)
    const currentProvenance = bindKnowledgeDocumentFieldSecretProvenance(
      {
        status: 'exact',
        entries: [{ encryptedValue: 'encrypted-filename', name: 'FILE_NAME' }],
      },
      'filename',
      CURRENT_DOCUMENT.filename
    )
    queueTableRows(document, [CURRENT_DOCUMENT])
    queueTableRows(documentSecretProvenance, [
      {
        documentId: CURRENT_DOCUMENT.id,
        sourceHash: hashDurableSecretProvenanceValue(currentSource),
        status: 'exact',
        entries: currentProvenance.status === 'exact' ? currentProvenance.entries : [],
      },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        ...CURRENT_DOCUMENT,
        filename: 'after.txt',
        secretProvenanceVersion: null,
      },
    ])

    await expect(
      updateDocument(CURRENT_DOCUMENT.id, { filename: 'after.txt' }, 'request-1')
    ).resolves.toMatchObject({ filename: 'after.txt' })

    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: CURRENT_DOCUMENT.id,
        status: 'exact',
        entries: [
          expect.objectContaining({
            encryptedValue: 'encrypted-filename',
            name: 'FILE_NAME',
            sourceValueHash: expect.any(String),
          }),
        ],
      })
    )
    expect(dbChainMockFns.set).toHaveBeenLastCalledWith({ secretProvenanceVersion: 1 })
  })
})
