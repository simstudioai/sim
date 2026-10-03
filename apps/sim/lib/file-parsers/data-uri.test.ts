import { describe, expect, it, vi } from 'vitest'
import { decodeDataUriWithinLimit } from '@/lib/file-parsers/data-uri'
import { FileParserError } from '@/lib/file-parsers/errors'

describe('decodeDataUriWithinLimit', () => {
  it('preserves commas after the first delimiter', () => {
    const decoded = decodeDataUriWithinLimit('data:text/plain,alpha,beta,gamma', 100)

    expect(decoded.buffer.toString('utf8')).toBe('alpha,beta,gamma')
    expect(decoded.mediaType).toBe('text/plain')
  })

  it('rejects malformed base64 instead of silently decoding a prefix', () => {
    expect(() => decodeDataUriWithinLimit('data:text/plain;base64,@@@=', 100)).toThrowError(
      expect.objectContaining({ code: 'invalid_format' })
    )
  })

  it('accepts valid unpadded base64 without weakening alphabet validation', () => {
    const decoded = decodeDataUriWithinLimit('data:text/plain;base64,aGk', 2)

    expect(decoded.buffer.toString('utf8')).toBe('hi')
  })

  it('accepts percent-escaped base64 bytes before validating padding', () => {
    const decoded = decodeDataUriWithinLimit('data:text/plain;base64,aGk%3D', 2)

    expect(decoded.buffer.toString('utf8')).toBe('hi')
  })

  it('rejects malformed percent escapes in a base64 payload', () => {
    expect(() => decodeDataUriWithinLimit('data:text/plain;base64,aGk%ZZ', 2)).toThrowError(
      expect.objectContaining({ code: 'invalid_format' })
    )
  })

  it('accepts a base64 payload at the encoded boundary, including whitespace', () => {
    const payload = Buffer.from('12345').toString('base64')
    const decoded = decodeDataUriWithinLimit(
      `data:application/octet-stream;base64,${payload.slice(0, 4)}\n${payload.slice(4)}`,
      5
    )

    expect(decoded.buffer.toString('utf8')).toBe('12345')
    expect(decoded.mediaType).toBe('application/octet-stream')
  })

  it('preserves percent-encoded binary octets that are not standalone UTF-8', () => {
    const decoded = decodeDataUriWithinLimit('data:application/octet-stream,%FF%00A', 3)

    expect([...decoded.buffer]).toEqual([0xff, 0x00, 0x41])
  })

  it('rejects the encoded representation before decoding', () => {
    const error = (() => {
      try {
        decodeDataUriWithinLimit(`data:text/plain,${'x'.repeat(50)}`, 10)
      } catch (caught) {
        return caught
      }
    })()

    expect(error).toBeInstanceOf(FileParserError)
    expect(error).toMatchObject({ code: 'complexity_limit' })
  })

  it('rejects an oversized descriptor before splitting its parameters', () => {
    const descriptor = `text/plain;${'x;'.repeat(4096)}`

    expect(() => decodeDataUriWithinLimit(`data:${descriptor},ok`, 10)).toThrowError(
      expect.objectContaining({ code: 'complexity_limit' })
    )
  })

  it('sizes non-base64 decode storage from the input instead of the file cap', () => {
    const allocation = vi.spyOn(Buffer, 'allocUnsafe')
    try {
      const decoded = decodeDataUriWithinLimit('data:text/plain,hi', 100 * 1024 * 1024)

      expect(decoded.buffer.toString('utf8')).toBe('hi')
      expect(allocation).toHaveBeenCalledWith(7)
    } finally {
      allocation.mockRestore()
    }
  })

  it('rejects decoded bytes beyond the cap', () => {
    const payload = Buffer.from('eleven-bytes').toString('base64')

    expect(() => decodeDataUriWithinLimit(`data:text/plain;base64,${payload}`, 10)).toThrowError(
      expect.objectContaining({ code: 'complexity_limit' })
    )
  })

  it('rejects a near-four-times base64 payload before decoding', () => {
    const maxBytes = 1024
    const payload = 'A'.repeat(maxBytes * 4)

    expect(() =>
      decodeDataUriWithinLimit(`data:application/octet-stream;base64,${payload}`, maxBytes)
    ).toThrowError(expect.objectContaining({ code: 'complexity_limit' }))
  })

  it('bounds base64 transport whitespace before compacting the payload', () => {
    const maxBytes = 1024
    const encodedPayload = Buffer.alloc(maxBytes).toString('base64')
    const whitespaceBomb = `${encodedPayload}${' '.repeat(2048)}`

    expect(() =>
      decodeDataUriWithinLimit(`data:application/octet-stream;base64,${whitespaceBomb}`, maxBytes)
    ).toThrowError(expect.objectContaining({ code: 'complexity_limit' }))
  })
})
