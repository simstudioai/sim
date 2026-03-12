/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { encodeRfc2047 } from './utils'

describe('encodeRfc2047', () => {
  it('returns ASCII text unchanged', () => {
    expect(encodeRfc2047('Simple ASCII Subject')).toBe('Simple ASCII Subject')
  })

  it('returns empty string unchanged', () => {
    expect(encodeRfc2047('')).toBe('')
  })

  it('encodes emojis as RFC 2047 base64', () => {
    const result = encodeRfc2047('Time to Stretch! 🧘')
    expect(result).toBe('=?UTF-8?B?VGltZSB0byBTdHJldGNoISDwn6eY?=')
  })

  it('round-trips non-ASCII subjects correctly', () => {
    const subjects = ['Hello 世界', 'Café résumé', '🎉🎊🎈 Party!', '今週のミーティング']
    for (const subject of subjects) {
      const encoded = encodeRfc2047(subject)
      const match = encoded.match(/^=\?UTF-8\?B\?(.+)\?=$/)
      expect(match).not.toBeNull()
      const decoded = Buffer.from(match![1], 'base64').toString('utf-8')
      expect(decoded).toBe(subject)
    }
  })

  it('does not double-encode already-encoded subjects', () => {
    const alreadyEncoded = '=?UTF-8?B?VGltZSB0byBTdHJldGNoISDwn6eY?='
    expect(encodeRfc2047(alreadyEncoded)).toBe(alreadyEncoded)
  })
})
