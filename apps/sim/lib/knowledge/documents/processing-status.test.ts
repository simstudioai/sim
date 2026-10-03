import { describe, expect, it } from 'vitest'
import { getDocumentProcessingOutcome } from '@/lib/knowledge/documents/processing-status'

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

  it('does not infer a source omission from an unknown state', () => {
    expect(getDocumentProcessingOutcome({ ...placeholder, processingStatus: 'invalid' })).toBeNull()
  })
})
