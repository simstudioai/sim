/**
 * @vitest-environment node
 */
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

  it('omits the multi-page hint for operations without an async mode', () => {
    const mapped = mapTextractSdkError(
      { name: 'UnsupportedDocumentException', message: 'Unsupported document' },
      true,
      { hasAsyncMode: false }
    )
    expect(mapped.message).not.toContain('Multi-Page')
    expect(mapped.message).toContain('Only JPEG, PNG, and single-page PDF files are supported')
  })

  it('does not rewrite the message for non-PDF unsupported documents', () => {
    const mapped = mapTextractSdkError(
      { name: 'UnsupportedDocumentException', message: 'Unsupported document' },
      false
    )
    expect(mapped.message).toBe('Unsupported document')
  })

  it('uses the SDK HTTP status', () => {
    const mapped = mapTextractSdkError(
      {
        name: 'InvalidParameterException',
        message: 'Bad param',
        $metadata: { httpStatusCode: 400 },
      },
      false
    )
    expect(mapped.status).toBe(400)
    expect(mapped.message).toBe('Bad param')
  })

  it('passes through a 5xx SDK status for retry classification', () => {
    const mapped = mapTextractSdkError(
      { message: 'Internal failure', $metadata: { httpStatusCode: 500 } },
      false
    )
    expect(mapped.status).toBe(500)
  })

  it('defaults to 500 without an SDK HTTP status', () => {
    expect(mapTextractSdkError({ message: 'Unknown failure' }, false).status).toBe(500)
  })
})
