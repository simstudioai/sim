/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { getDocumentProcessingOutcome } from '@/lib/knowledge/documents/processing-status'
import { DOCUMENT_PROCESSING_STATUSES } from '@/lib/knowledge/documents/types'

describe('document processing outcomes', () => {
  const placeholder = {
    processingStatus: 'failed',
    externalId: 'source-file',
    storageKey: null,
    contentHash: 'known-version',
    fileUrl: '',
  }

  it('recognizes a legacy intentional skip without reading error text or contacting its source', () => {
    expect(getDocumentProcessingOutcome(placeholder)).toBe('skipped')
  })

  it.each([
    { ...placeholder, contentHash: null },
    { ...placeholder, storageKey: 'kb/stored.txt' },
    { ...placeholder, externalId: null },
    { ...placeholder, fileUrl: 'https://fixture.test/stored.txt' },
  ])('preserves real source, indexing, and upload failures: %j', (row) => {
    expect(getDocumentProcessingOutcome(row)).toBeNull()
  })

  it.each(DOCUMENT_PROCESSING_STATUSES)(
    'preserves a stored %s outcome with an artifact',
    (status) => {
      expect(
        getDocumentProcessingOutcome({
          ...placeholder,
          processingStatus: status,
          storageKey: 'kb/stored.txt',
        })
      ).toBeNull()
    }
  )

  it('does not infer a source omission from an unknown state', () => {
    expect(getDocumentProcessingOutcome({ ...placeholder, processingStatus: 'invalid' })).toBeNull()
  })
})
