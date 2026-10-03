import { describe, expect, it } from 'vitest'
import freeEmailDomains from '@/lib/messaging/email/free-email-domains.json'
import { isFreeEmailDomain } from './free-email'

describe('isFreeEmailDomain', () => {
  /**
   * Upstream joins each of these pairs into one entry, which made all four read as work
   * addresses. They are split in the vendored list, so this guards against a naive refresh.
   */
  it('returns true for the providers upstream fuses into a single entry', () => {
    expect(isFreeEmailDomain('jane@mail2moldova.com')).toBe(true)
    expect(isFreeEmailDomain('jane@mail2molly.com')).toBe(true)
    expect(isFreeEmailDomain('jane@smileyface.com')).toBe(true)
    expect(isFreeEmailDomain('jane@smithemail.net')).toBe(true)
  })

  it('carries no entry that is two domains concatenated', () => {
    const suffixes = ['.com', '.net', '.org', '.info', '.biz']
    const fused = freeEmailDomains.filter((entry) =>
      suffixes.some((suffix) => {
        const at = entry.indexOf(suffix)
        if (at === -1 || at + suffix.length >= entry.length) return false
        const rest = entry.slice(at + suffix.length)
        return rest.includes('.') && rest.split('.')[0].length >= 3
      })
    )
    expect(fused).toEqual(['cable.comcast.com'])
  })
})
