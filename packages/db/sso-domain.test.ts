import { describe, expect, it } from 'vitest'
import { ssoDomainsOverlap } from './sso-domain'

describe('ssoDomainsOverlap', () => {
  it.each([
    ['acme.com', 'acme.com'],
    ['ACME.COM', 'acme.com'],
    ['LOGIN.ACME.COM', 'acme.com'],
    ['acme.com', 'LOGIN.ACME.COM'],
  ])('detects exact and parent/child overlap between %s and %s', (left, right) => {
    expect(ssoDomainsOverlap(left, right)).toBe(true)
  })

  it('does not treat a label suffix as a subdomain', () => {
    expect(ssoDomainsOverlap('notacme.com', 'acme.com')).toBe(false)
  })
})
