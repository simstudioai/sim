import { describe, expect, it } from 'vitest'
import { mapTextractSdkError } from '@/lib/internal/textract/errors'

describe('mapTextractSdkError', () => {
  it('gives a friendly hint for unsupported PDFs in single-page mode', () => {
    const mapped = mapTextractSdkError(
      { name: 'UnsupportedDocumentException', message: 'Unsupported document' },
      true
    )
    expect(mapped.status).toBe(400)
    expect(mapped.message).toContain('Multi-Page (PDF, TIFF via S3)')
  })

  it('passes through a 5xx SDK status for retry classification', () => {
    const mapped = mapTextractSdkError(
      { message: 'Internal failure', $metadata: { httpStatusCode: 500 } },
      false
    )
    expect(mapped.status).toBe(500)
  })
})
