/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { assertOcrSourceSupported } from '@/lib/knowledge/documents/ocr-source-validation'

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')

describe('OCR source preflight', () => {
  it('accepts static GIFs without decoding their pixels', () => {
    expect(() => assertOcrSourceSupported(GIF, 'image/gif')).not.toThrow()
  })
  it('rejects animations before a one-image OCR request could omit later frames', () => {
    const animation = Buffer.concat([
      GIF.subarray(0, -1),
      GIF.subarray(19, -1),
      Buffer.from([0x3b]),
    ])
    expect(() => assertOcrSourceSupported(animation, 'image/gif')).toThrow(
      expect.objectContaining({ code: 'unsupported_file_type' })
    )
  })
  it.each([Buffer.alloc(0), GIF.subarray(0, 16), GIF.subarray(0, -1), Buffer.from('not a GIF')])(
    'rejects a malformed or truncated GIF without unbounded scanning',
    (buffer) => {
      expect(() => assertOcrSourceSupported(buffer, 'image/gif')).toThrow(
        expect.objectContaining({ code: 'invalid_file' })
      )
    }
  )
  it('rejects content mislabeled as PDF and preserves recoverable PDF input', () => {
    expect(() =>
      assertOcrSourceSupported(Buffer.from('<html>Download failed</html>'), 'application/pdf')
    ).toThrow(expect.objectContaining({ code: 'invalid_file' }))
    expect(() =>
      assertOcrSourceSupported(Buffer.from('\n%PDF-1.7\n'), 'application/pdf')
    ).not.toThrow()
  })
})
