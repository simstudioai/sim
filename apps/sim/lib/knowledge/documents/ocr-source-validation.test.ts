/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { assertOcrSourceSupported } from '@/lib/knowledge/documents/ocr-source-validation'

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')
const LFS_POINTER = `version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}\nsize 9566\n`

describe('OCR source preflight', () => {
  it.each(['image/png', 'image/jpeg', 'image/gif', 'application/pdf'])(
    'reports missing Git LFS content for %s without classifying it as a provider failure',
    (mimeType) => {
      expect(() => assertOcrSourceSupported(Buffer.from(LFS_POINTER), mimeType)).toThrow(
        expect.objectContaining({
          name: 'PermanentDocumentProcessingError',
          code: 'invalid_file',
          message: expect.stringContaining('Git LFS pointer'),
        })
      )
    }
  )
  it('recognizes a pointer exported with Windows line endings', () => {
    expect(() =>
      assertOcrSourceSupported(Buffer.from(LFS_POINTER.replaceAll('\n', '\r\n')), 'image/png')
    ).toThrow(expect.objectContaining({ code: 'invalid_file' }))
  })
  it.each(['\n', '\r\n'])('recognizes extension records with %j line endings', (newline) => {
    const pointer = LFS_POINTER.replace(
      'oid sha256:',
      `ext-0-compress sha256:${'b'.repeat(64)}\next-1-encrypt sha256:${'c'.repeat(64)}\noid sha256:`
    ).replaceAll('\n', newline)
    expect(() => assertOcrSourceSupported(Buffer.from(pointer), 'image/png')).toThrow(
      expect.objectContaining({
        code: 'invalid_file',
        message: expect.stringContaining('Git LFS pointer'),
      })
    )
    expect(() =>
      assertOcrSourceSupported(Buffer.from(`${pointer}arbitrary trailing content`), 'image/png')
    ).not.toThrow()
    expect(() =>
      assertOcrSourceSupported(
        Buffer.from(pointer.replace('ext-0-compress sha256:', 'ext-0-compress sha1:')),
        'image/png'
      )
    ).not.toThrow()
  })
  it('preserves small images and files containing a pointer as text', () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
      'base64'
    )
    expect(png.length).toBeLessThan(Buffer.byteLength(LFS_POINTER))
    expect(() => assertOcrSourceSupported(png, 'image/png')).not.toThrow()
    expect(() => assertOcrSourceSupported(Buffer.from(LFS_POINTER), 'text/plain')).not.toThrow()
    expect(() =>
      assertOcrSourceSupported(Buffer.concat([png, Buffer.from(LFS_POINTER)]), 'image/png')
    ).not.toThrow()
  })
  it('requires a complete pointer rather than matching a version URL alone', () => {
    for (const content of [
      'version https://git-lfs.github.com/spec/v1\n',
      LFS_POINTER.replace('sha256:', 'sha1:'),
      LFS_POINTER.replace('9566', 'unknown'),
      `${LFS_POINTER}additional content`,
      `${LFS_POINTER}${'x'.repeat(1024)}`,
    ]) {
      expect(() => assertOcrSourceSupported(Buffer.from(content), 'image/png')).not.toThrow()
    }
  })
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
