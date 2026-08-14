/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { sanitizeTextForUTF8, truncationNotice } from '@/lib/file-parsers/utils'

const LONE_HIGH = '\uD800'
const LONE_LOW = '\uDC00'

describe('sanitizeTextForUTF8', () => {
  it('preserves non-BMP characters built from valid surrogate pairs', () => {
    const text = 'emoji 😀 cjk-ext-b 𠮷野家 math 𝐀𝐁𝐂'

    expect(sanitizeTextForUTF8(text)).toBe(text)
  })

  it('removes unpaired surrogates', () => {
    expect(sanitizeTextForUTF8(`a${LONE_HIGH}b`)).toBe('ab')
    expect(sanitizeTextForUTF8(`a${LONE_LOW}b`)).toBe('ab')
  })

  it('removes an unpaired surrogate without disturbing an adjacent valid pair', () => {
    expect(sanitizeTextForUTF8(`😀${LONE_HIGH}😀`)).toBe('😀😀')
  })

  it('round-trips through UTF-8 after sanitizing', () => {
    const sanitized = sanitizeTextForUTF8(`😀${LONE_LOW}𠮷`)

    expect(Buffer.from(sanitized, 'utf8').toString('utf8')).toBe(sanitized)
    expect(sanitized).toBe('😀𠮷')
  })

  it('removes control characters but keeps tab, newline, and carriage return', () => {
    expect(sanitizeTextForUTF8('a\x07b\x7Fc')).toBe('abc')
    expect(sanitizeTextForUTF8('a\tb\nc\rd')).toBe('a\tb\nc\rd')
  })

  it('removes null bytes and replacement characters', () => {
    expect(sanitizeTextForUTF8('a\x00b\uFFFDc')).toBe('abc')
  })

  it('returns an empty string for empty or non-string input', () => {
    expect(sanitizeTextForUTF8('')).toBe('')
    expect(sanitizeTextForUTF8(undefined as unknown as string)).toBe('')
  })
})

describe('truncationNotice', () => {
  it('wraps the detail in the shared inline marker', () => {
    expect(truncationNotice('42 total rows, showing first 10')).toBe(
      '\n[... 42 total rows, showing first 10 ...]\n'
    )
  })
})
