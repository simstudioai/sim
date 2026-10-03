import { describe, expect, it } from 'vitest'
import { assessTextPaste, utf8ByteLength } from './paste'

describe('utf8ByteLength', () => {
  it('matches UTF-8 for ASCII, BMP, astral, and malformed UTF-16', () => {
    for (const value of ['plain text', 'café', '你好', '💡', '\ud800']) {
      expect(utf8ByteLength(value)).toBe(new TextEncoder().encode(value).byteLength)
    }
  })
})

describe('assessTextPaste', () => {
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
