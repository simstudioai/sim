/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import freeEmailDomains from '@/lib/messaging/email/free-email-domains.json'
import { isFreeEmailDomain } from './free-email'

describe('isFreeEmailDomain', () => {
  it('returns true for known free/personal providers', () => {
    expect(isFreeEmailDomain('jane@gmail.com')).toBe(true)
    expect(isFreeEmailDomain('jane@yahoo.com')).toBe(true)
    expect(isFreeEmailDomain('jane@hotmail.com')).toBe(true)
  })

  it('returns false for work domains', () => {
    expect(isFreeEmailDomain('jane@acme.co')).toBe(false)
    expect(isFreeEmailDomain('jane@sim.ai')).toBe(false)
  })

  it('is case-insensitive on the domain', () => {
    expect(isFreeEmailDomain('Jane@GMAIL.com')).toBe(true)
  })

  it('returns false when there is no domain', () => {
    expect(isFreeEmailDomain('jane')).toBe(false)
    expect(isFreeEmailDomain('')).toBe(false)
  })

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
