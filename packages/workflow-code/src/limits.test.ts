import { describe, expect, it } from 'vitest'
import { utf8Bytes } from './limits'

const encoded = (text: string) => new TextEncoder().encode(text).length

describe('utf8Bytes', () => {
  it('counts what TextEncoder writes, lone surrogates included', () => {
    for (const text of [
      'a',
      'é',
      '中',
      '😀',
      '\uD800',
      '\uDC00',
      '\uD800a',
      '\uD800é',
      '\uD800中',
      '\uD800𐀀',
    ]) {
      expect(utf8Bytes(text)).toBe(encoded(text))
    }
  })
})
