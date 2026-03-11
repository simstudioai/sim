/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { encodeRfc2047 } from './utils'

describe('encodeRfc2047', () => {
  it('returns ASCII text unchanged', () => {
    const input = 'Simple ASCII Subject'
    expect(encodeRfc2047(input)).toBe(input)
  })

  it('encodes short non-ASCII text in a single encoded word', () => {
    const input = 'Hello 世界'
    const result = encodeRfc2047(input)
    expect(result).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/)
    expect(result.length).toBeLessThanOrEqual(75)
  })

  it('splits long non-ASCII text into multiple encoded words', () => {
    const input = '今週のミーティングアジェンダについて検討します'
    const result = encodeRfc2047(input)
    expect(result).toContain('\r\n ')
    const words = result.split('\r\n ')
    expect(words.length).toBeGreaterThan(1)
    words.forEach((word) => {
      expect(word.length).toBeLessThanOrEqual(75)
      expect(word).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/)
    })
  })

  it('handles very long subjects with emojis', () => {
    const input = '🎉 '.repeat(30)
    const result = encodeRfc2047(input)
    const words = result.split('\r\n ')
    words.forEach((word) => {
      expect(word.length).toBeLessThanOrEqual(75)
      expect(word).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/)
    })
  })

  it('handles edge case of exactly 47 bytes of UTF-8', () => {
    const input = 'a'.repeat(47)
    const result = encodeRfc2047(input)
    expect(result).not.toContain('\r\n ')
  })
})
