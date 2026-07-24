/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { normalizeSSODomain } from '@/lib/auth/sso/domain'

describe('normalizeSSODomain', () => {
  it('lowercases and trims', () => {
    expect(normalizeSSODomain('  Company.COM ')).toBe('company.com')
  })

  it('drops a trailing dot', () => {
    expect(normalizeSSODomain('company.com.')).toBe('company.com')
  })

  it('treats casing variants as the same domain', () => {
    expect(normalizeSSODomain('Company.COM')).toBe(normalizeSSODomain('company.com'))
  })

  it('accepts registrable domains and subdomains', () => {
    expect(normalizeSSODomain('login.company.co.uk')).toBe('login.company.co.uk')
  })

  it('rejects transformed values and comma lists', () => {
    expect(normalizeSSODomain('https://company.com/sso')).toBeNull()
    expect(normalizeSSODomain('company.com:8443')).toBeNull()
    expect(normalizeSSODomain('*.company.com')).toBeNull()
    expect(normalizeSSODomain('@company.com')).toBeNull()
    expect(normalizeSSODomain('user@company.com')).toBeNull()
    expect(normalizeSSODomain('company.com,subsidiary.com')).toBeNull()
  })

  it('rejects values that are not registrable or use unknown suffixes', () => {
    expect(normalizeSSODomain('')).toBeNull()
    expect(normalizeSSODomain('localhost')).toBeNull()
    expect(normalizeSSODomain('not a domain')).toBeNull()
    expect(normalizeSSODomain('company')).toBeNull()
    expect(normalizeSSODomain('company.invalid')).toBeNull()
    expect(normalizeSSODomain('com')).toBeNull()
  })

  it('rejects bare IP addresses and numeric TLDs', () => {
    expect(normalizeSSODomain('10.0.0.1')).toBeNull()
    expect(normalizeSSODomain('192.168.1.1')).toBeNull()
    expect(normalizeSSODomain('company.123')).toBeNull()
  })
})
