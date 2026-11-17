import { describe, expect, it } from 'vitest'
import { utf8Bytes } from './limits'

describe('utf8Bytes', () => {
  it('counts the bytes UTF-8 encoding writes, a lone surrogate as U+FFFD', () => {
    const cases: Array<[string, number]> = [
      ['a', 1],
      ['é', 2],
      ['中', 3],
      ['😀', 4],
      ['\uD800', 3],
      ['\uDC00', 3],
      ['\uD800a', 4],
      ['\uD800é', 5],
      ['\uD800中', 6],
      ['\uD800𐀀', 7],
    ]
    for (const [text, bytes] of cases) expect(utf8Bytes(text)).toBe(bytes)
  })
})
