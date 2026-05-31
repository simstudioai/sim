/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { normalizeSSODomain } from '@/lib/auth/sso/domain'

describe('normalizeSSODomain', () => {
  it('lowercases and trims', () => {
    expect(normalizeSSODomain('  Company.COM ')).toBe('company.com')
  })

  it('strips protocol, path, query, and port', () => {
    expect(normalizeSSODomain('https://company.com/sso?x=1')).toBe('company.com')
    expect(normalizeSSODomain('company.com:8443')).toBe('company.com')
  })

  it('strips wildcard, leading @, and email local part', () => {
    expect(normalizeSSODomain('*.company.com')).toBe('company.com')
    expect(normalizeSSODomain('@company.com')).toBe('company.com')
    expect(normalizeSSODomain('user@company.com')).toBe('company.com')
  })

  it('drops a trailing dot', () => {
    expect(normalizeSSODomain('company.com.')).toBe('company.com')
  })

  it('treats casing and formatting variants as the same domain', () => {
    expect(normalizeSSODomain('Company.COM')).toBe(normalizeSSODomain('company.com'))
    expect(normalizeSSODomain('user@Company.com')).toBe(normalizeSSODomain('company.com'))
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
