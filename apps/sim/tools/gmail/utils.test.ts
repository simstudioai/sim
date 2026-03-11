/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { encodeRfc2047 } from './utils'

/**
 * Decode an RFC 2047 encoded header (single or multi-word) back to a string.
 */
function decodeRfc2047(encoded: string): string {
  const words = encoded.split(/\r\n\s+/)
  return words
    .map((word) => {
      const match = word.match(/^=\?UTF-8\?B\?(.+)\?=$/)
      if (!match) return word
      return Buffer.from(match[1], 'base64').toString('utf-8')
    })
    .join('')
}

describe('encodeRfc2047', () => {
  it('returns ASCII text unchanged', () => {
    const input = 'Simple ASCII Subject'
    expect(encodeRfc2047(input)).toBe(input)
  })

  it('returns empty string unchanged', () => {
    expect(encodeRfc2047('')).toBe('')
  })

  it('encodes short non-ASCII text in a single encoded word', () => {
    const input = 'Hello 世界'
    const result = encodeRfc2047(input)
    expect(result).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/)
    expect(result.length).toBeLessThanOrEqual(75)
    expect(decodeRfc2047(result)).toBe(input)
  })

  it('encodes emojis correctly', () => {
    const input = 'Time to Stretch! 🧘'
    const result = encodeRfc2047(input)
    expect(result).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/)
    expect(decodeRfc2047(result)).toBe(input)
  })

  it('splits long non-ASCII text into multiple encoded words', () => {
    const input = '今週のミーティングアジェンダについて検討します'
    const result = encodeRfc2047(input)
    const words = result.split('\r\n ')
    words.forEach((word) => {
      expect(word.length).toBeLessThanOrEqual(75)
      expect(word).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/)
    })
    expect(decodeRfc2047(result)).toBe(input)
  })

  it('handles very long subjects with emojis without splitting characters', () => {
    const input = '🎉 '.repeat(30)
    const result = encodeRfc2047(input)
    const words = result.split('\r\n ')
    words.forEach((word) => {
      expect(word.length).toBeLessThanOrEqual(75)
      expect(word).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/)
    })
    expect(decodeRfc2047(result)).toBe(input)
  })

  it('does not split already-encoded subjects (pure ASCII passthrough)', () => {
    const input = '=?UTF-8?B?VGltZSB0byBTdHJldGNoISDwn6eY?='
    const result = encodeRfc2047(input)
    expect(result).toBe(input)
  })

  it('handles accented characters', () => {
    const input = 'Café résumé'
    const result = encodeRfc2047(input)
    expect(result).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/)
    expect(decodeRfc2047(result)).toBe(input)
  })

  it('handles mixed ASCII and multi-byte characters in long subjects', () => {
    const input = 'Important: 会議の議事録をお送りします - please review by Friday 🙏'
    const result = encodeRfc2047(input)
    const words = result.split('\r\n ')
    words.forEach((word) => {
      expect(word.length).toBeLessThanOrEqual(75)
    })
    expect(decodeRfc2047(result)).toBe(input)
  })
})
