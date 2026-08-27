import { describe, expect, it } from 'vitest'
import {
  assessTextPaste,
  countPasteRows,
  formatPasteLimit,
  utf8ByteLength,
  utf8ByteLengthRange,
} from './paste'

describe('utf8ByteLength', () => {
  it('matches UTF-8 for ASCII, BMP, astral, and malformed UTF-16', () => {
    for (const value of ['plain text', 'café', '你好', '💡', '\ud800']) {
      expect(utf8ByteLength(value)).toBe(new TextEncoder().encode(value).byteLength)
    }
  })

  it('short-circuits once the limit is exceeded', () => {
    expect(utf8ByteLength('a'.repeat(1_000_000), 100)).toBe(101)
  })

  it('measures a range without slicing the source', () => {
    expect(utf8ByteLengthRange('a💡b', 1, 3)).toBe(4)
  })
})

describe('assessTextPaste', () => {
  it('accepts a selection replacement at the projected boundary', () => {
    expect(
      assessTextPaste({
        pastedText: '💡',
        currentText: '123456',
        selectionStart: 1,
        selectionEnd: 5,
        maxResultBytes: 6,
      })
    ).toMatchObject({ accepted: true, resultBytes: 6 })
  })

  it('rejects payload characters before scanning bytes', () => {
    expect(
      assessTextPaste({ pastedText: 'abc', maxPastedCharacters: 2, maxPastedBytes: 100 })
    ).toEqual({ accepted: false, reason: 'pasted-characters', actual: 3, limit: 2 })
  })

  it('rejects non-ASCII payloads by exact byte size', () => {
    expect(assessTextPaste({ pastedText: '💡', maxPastedBytes: 3 })).toEqual({
      accepted: false,
      reason: 'pasted-bytes',
      actual: 4,
      limit: 3,
    })
  })

  it('rejects a projected result above its character limit', () => {
    expect(
      assessTextPaste({
        pastedText: 'xyz',
        currentText: 'abcd',
        selectionStart: 1,
        selectionEnd: 2,
        maxResultCharacters: 5,
      })
    ).toEqual({ accepted: false, reason: 'result-characters', actual: 6, limit: 5 })
  })
})

describe('countPasteRows', () => {
  it('handles LF, CRLF, and CR without allocating rows', () => {
    expect(countPasteRows('a\nb\r\nc\rd')).toBe(4)
    expect(countPasteRows('')).toBe(0)
  })

  it('short-circuits above a row ceiling', () => {
    expect(countPasteRows('a\nb\nc\nd', 2)).toBe(3)
  })
})

it('formats binary paste limits', () => {
  expect(formatPasteLimit(256 * 1024)).toBe('256 KiB')
  expect(formatPasteLimit(1_000_000)).toBe('1 MB')
  expect(formatPasteLimit(5 * 1024 * 1024)).toBe('5 MiB')
})
