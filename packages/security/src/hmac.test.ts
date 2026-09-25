import { describe, expect, it } from 'vitest'
import { hmacSha256Base64, hmacSha256Hex } from './hmac'

describe('hmacSha256Hex', () => {
  it('matches RFC 4231 test vector 1', () => {
    const key = Buffer.from('0b'.repeat(20), 'hex').toString('binary')
    expect(hmacSha256Hex('Hi There', key)).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'
    )
  })

  it('accepts a Buffer secret and matches the equivalent binary-string secret', () => {
    const raw = Buffer.from('0b'.repeat(20), 'hex')
    expect(hmacSha256Hex('Hi There', raw)).toBe(hmacSha256Hex('Hi There', raw.toString('binary')))
  })
})

describe('hmacSha256Base64', () => {
  it('agrees with hex form via Buffer conversion', () => {
    const hex = hmacSha256Hex('body', 'secret')
    const b64 = hmacSha256Base64('body', 'secret')
    expect(Buffer.from(b64, 'base64').toString('hex')).toBe(hex)
  })
})
