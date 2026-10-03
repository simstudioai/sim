import { describe, expect, it } from 'vitest'
import { normalizeSSODomain } from './sso-domain'

describe('normalizeSSODomain', () => {
  it('strips wildcard, leading @, and email local part', () => {
    expect(normalizeSSODomain('*.company.com')).toBe('company.com')
    expect(normalizeSSODomain('@company.com')).toBe('company.com')
    expect(normalizeSSODomain('user@company.com')).toBe('company.com')
  })

  it('rejects values that are not registrable domains', () => {
    expect(normalizeSSODomain('')).toBeNull()
    expect(normalizeSSODomain('localhost')).toBeNull()
    expect(normalizeSSODomain('not a domain')).toBeNull()
    expect(normalizeSSODomain('company')).toBeNull()
  })

  it('rejects bare IP addresses and numeric TLDs', () => {
    expect(normalizeSSODomain('10.0.0.1')).toBeNull()
    expect(normalizeSSODomain('192.168.1.1')).toBeNull()
    expect(normalizeSSODomain('company.123')).toBeNull()
  })
})
