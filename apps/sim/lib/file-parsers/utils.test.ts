import { describe, expect, it } from 'vitest'
import {
  decodeTextBuffer,
  decodeWindows1252,
  decodeWindows1252WithTable,
  sanitizeTextForUTF8,
  TRUNCATED_UTF8_WARNING,
  WINDOWS_1252_WARNING,
} from '@/lib/file-parsers/utils'

const LONE_HIGH = '\uD800'
const LONE_LOW = '\uDC00'

describe('sanitizeTextForUTF8', () => {
  it('removes unpaired surrogates', () => {
    expect(sanitizeTextForUTF8(`a${LONE_HIGH}b`)).toBe('ab')
    expect(sanitizeTextForUTF8(`a${LONE_LOW}b`)).toBe('ab')
  })

  it('removes an unpaired surrogate without disturbing an adjacent valid pair', () => {
    expect(sanitizeTextForUTF8(`😀${LONE_HIGH}😀`)).toBe('😀😀')
  })

  it('removes control characters but keeps tab, newline, and carriage return', () => {
    expect(sanitizeTextForUTF8('a\x07b\x7Fc')).toBe('abc')
    expect(sanitizeTextForUTF8('a\tb\nc\rd')).toBe('a\tb\nc\rd')
  })
})

describe('decodeTextBuffer', () => {
  it('strips a UTF-8 BOM so it never reaches content or character counts', () => {
    const decoded = decodeTextBuffer(
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Café ok')])
    )

    expect(decoded.text).toBe('Café ok')
    expect(decoded.text.length).toBe(7)
    expect(decoded.encoding).toBe('utf-8')
  })

  it('decodes Latin-1 bytes as Windows-1252 instead of destroying accented characters', () => {
    const decoded = decodeTextBuffer(Buffer.from('Caf\xe9 r\xe9sum\xe9 na\xefve \xa3 42', 'latin1'))

    expect(decoded.text).toBe('Café résumé naïve £ 42')
    expect(decoded.encoding).toBe('windows-1252')
    expect(decoded.warning).toBe(WINDOWS_1252_WARNING)
    expect(sanitizeTextForUTF8(decoded.text)).toBe('Café résumé naïve £ 42')
  })

  it('recognizes BOM-less UTF-16LE text instead of reading it as NUL-riddled UTF-8', () => {
    const decoded = decodeTextBuffer(Buffer.from('Hello UTF-16 world without a BOM', 'utf16le'))

    expect(decoded).toEqual({ text: 'Hello UTF-16 world without a BOM', encoding: 'utf-16le' })
  })

  it('keeps the UTF-8 reading when only a trailing codepoint was truncated', () => {
    const full = Buffer.from('Truncated download résumé 😀', 'utf8')
    const decoded = decodeTextBuffer(full.subarray(0, full.length - 2))

    expect(decoded.text).toBe('Truncated download résumé ')
    expect(decoded.encoding).toBe('utf-8')
    expect(decoded.warning).toBe(TRUNCATED_UTF8_WARNING)
  })

  it('does not mistake a Latin-1 file ending in an accented letter for truncated UTF-8', () => {
    expect(decodeTextBuffer(Buffer.from('name: Caf\xe9', 'latin1'))).toMatchObject({
      text: 'name: Café',
      encoding: 'windows-1252',
    })
    expect(decodeTextBuffer(Buffer.from('Caf\xe9\n', 'latin1')).text).toBe('Café\n')
  })

  it('maps every Windows-1252 byte to the WHATWG code point on both decode paths', () => {
    const everyByte = new Uint8Array(Array.from({ length: 256 }, (_, index) => index))
    const expectedC1 =
      '\u20AC\u0081\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u008D\u017D\u008F' +
      '\u0090\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u009D\u017E\u0178'

    for (const decode of [decodeWindows1252, decodeWindows1252WithTable]) {
      const decoded = decode(everyByte)
      expect(decoded.length).toBe(256)
      expect(decoded.slice(0, 0x80)).toBe(
        String.fromCharCode(...Array.from({ length: 0x80 }, (_, index) => index))
      )
      expect(decoded.slice(0x80, 0xa0)).toBe(expectedC1)
      expect(decoded.slice(0xa0)).toBe(Buffer.from(everyByte.subarray(0xa0)).toString('latin1'))
    }
  })

  it('decodes a large C1-heavy buffer in one bounded pass', () => {
    const heavy = new Uint8Array(4 * 1024 * 1024).fill(0x93)

    const decoded = decodeWindows1252WithTable(heavy)

    expect(decoded.length).toBe(heavy.length)
    expect(decoded.charCodeAt(0)).toBe(0x201c)
    expect(decoded.charCodeAt(heavy.length - 1)).toBe(0x201c)
  })
})
