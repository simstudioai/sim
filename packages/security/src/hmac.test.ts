import { describe, expect, it } from 'vitest'
import { hmacSha256Base64, hmacSha256Hex } from './hmac'

describe('hmacSha256Hex', () => {
  it('is deterministic', () => {
    expect(hmacSha256Hex('body', 'secret')).toBe(hmacSha256Hex('body', 'secret'))
  })

  it('returns a 64-char hex digest', () => {
    expect(hmacSha256Hex('body', 'secret')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('matches RFC 4231 test vector 1', () => {
    const key = Buffer.from('0b'.repeat(20), 'hex').toString('binary')
    expect(hmacSha256Hex('Hi There', key)).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'
    )
  })

  it('differs when body changes', () => {
    expect(hmacSha256Hex('a', 'k')).not.toBe(hmacSha256Hex('b', 'k'))
  })

  it('differs when secret changes', () => {
    expect(hmacSha256Hex('body', 'k1')).not.toBe(hmacSha256Hex('body', 'k2'))
  })

  it('accepts a Buffer secret and matches the equivalent binary-string secret', () => {
    const raw = Buffer.from('0b'.repeat(20), 'hex')
    expect(hmacSha256Hex('Hi There', raw)).toBe(hmacSha256Hex('Hi There', raw.toString('binary')))
  })
})

describe('hmacSha256Base64', () => {
  it('is deterministic', () => {
    expect(hmacSha256Base64('body', 'secret')).toBe(hmacSha256Base64('body', 'secret'))
  })

  it('returns a base64 digest', () => {
    expect(hmacSha256Base64('body', 'secret')).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })

  it('agrees with hex form via Buffer conversion', () => {
    const hex = hmacSha256Hex('body', 'secret')
    const b64 = hmacSha256Base64('body', 'secret')
    expect(Buffer.from(b64, 'base64').toString('hex')).toBe(hex)
  })

  it('accepts a Buffer secret (Svix / MS-Teams scheme)', () => {
    const secret = Buffer.from('whsec-decoded-bytes')
    const hex = hmacSha256Hex('body', secret)
    const b64 = hmacSha256Base64('body', secret)
    expect(Buffer.from(b64, 'base64').toString('hex')).toBe(hex)
  })
})
