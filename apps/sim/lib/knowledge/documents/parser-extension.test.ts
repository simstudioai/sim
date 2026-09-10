/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { classifyDocumentProcessingFailure } from '@/lib/knowledge/documents/document-processing-error'
import { resolveParserExtension } from '@/lib/knowledge/documents/parser-extension'

describe('resolveParserExtension', () => {
  it('uses a supported filename extension when present', () => {
    expect(resolveParserExtension('report.pdf', 'application/pdf')).toBe('pdf')
  })

  it('falls back to mime type when filename has no extension', () => {
    expect(
      resolveParserExtension('[Business] Your Thursday morning trip with Uber', 'text/plain')
    ).toBe('txt')
  })

  it('falls back to mime type when filename extension is unsupported', () => {
    expect(resolveParserExtension('uber-message.business', 'text/plain')).toBe('txt')
  })

  it('throws when neither filename nor mime type resolves to a supported parser', () => {
    expect(() =>
      resolveParserExtension('uber-message.unknown', 'application/octet-stream')
    ).toThrow('Unsupported file type')
  })

  /**
   * Documents stored before `.ppt` was dropped from the registry re-enter the
   * pipeline through this resolver. A plain `Error` classified as transient and
   * burned the retry budget; the typed code makes the failure permanent.
   */
  it.each([
    ['Deck.ppt', 'application/vnd.ms-powerpoint'],
    ['no-extension', 'application/octet-stream'],
  ])('classifies an unresolvable %s as a permanent unsupported type', (filename, mimeType) => {
    const error = (() => {
      try {
        resolveParserExtension(filename, mimeType)
        return null
      } catch (caught) {
        return caught
      }
    })()

    expect(error).toMatchObject({ name: 'FileParserError', code: 'unsupported_type' })
    expect(classifyDocumentProcessingFailure(error, filename)).toMatchObject({
      disposition: 'permanent',
      code: 'unsupported_file_type',
    })
  })
})
