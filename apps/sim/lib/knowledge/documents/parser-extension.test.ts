/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
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
})
