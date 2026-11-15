import { describe, expect, it } from 'vitest'
import { isEmailInSSODomain, normalizeSSODomain } from './sso-domain'

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

describe('isEmailInSSODomain', () => {
  it('matches an address whose mailbox domain is the provider domain', () => {
    expect(isEmailInSSODomain('member@Company.com', 'company.com')).toBe(true)
  })

  it('reads the mailbox domain after the last @, never a domain-shaped local part', () => {
    expect(isEmailInSSODomain('company.com/ceo@victim.test', 'company.com')).toBe(false)
    expect(isEmailInSSODomain('company.com?ceo@victim.test', 'company.com')).toBe(false)
    expect(isEmailInSSODomain('ceo@company.com?x@victim.test', 'company.com')).toBe(false)
    expect(isEmailInSSODomain('ceo@company.com:443@victim.test', 'company.com')).toBe(false)
  })

  it('refuses a mailbox domain carrying anything but domain characters', () => {
    expect(isEmailInSSODomain('ceo@company.com/x', 'company.com')).toBe(false)
    expect(isEmailInSSODomain('ceo@company.com:443', 'company.com')).toBe(false)
    expect(isEmailInSSODomain('company.com', 'company.com')).toBe(false)
  })
})
