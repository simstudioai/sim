/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isEmailInDenylist } from '@/lib/auth/auth'

describe('isEmailInDenylist', () => {
  it('returns false when denylist is null, empty, or email is missing', () => {
    expect(isEmailInDenylist('a@example.com', null)).toBe(false)
    expect(isEmailInDenylist('a@example.com', [])).toBe(false)
    expect(isEmailInDenylist(null, ['example.com'])).toBe(false)
    expect(isEmailInDenylist(undefined, ['example.com'])).toBe(false)
    expect(isEmailInDenylist('', ['example.com'])).toBe(false)
  })

  it('returns false when email has no @', () => {
    expect(isEmailInDenylist('not-an-email', ['example.com'])).toBe(false)
  })

  it('matches exact domain', () => {
    expect(isEmailInDenylist('user@dpdns.org', ['dpdns.org'])).toBe(true)
    expect(isEmailInDenylist('user@DPDNS.ORG', ['dpdns.org'])).toBe(true)
  })

  it('matches arbitrary-depth subdomains of a listed parent zone', () => {
    expect(isEmailInDenylist('user@xx.lucky04.dpdns.org', ['dpdns.org'])).toBe(true)
    expect(isEmailInDenylist('user@a.b.c.qzz.io', ['qzz.io'])).toBe(true)
  })

  it('does not match look-alike domains', () => {
    expect(isEmailInDenylist('user@xdpdns.org', ['dpdns.org'])).toBe(false)
    expect(isEmailInDenylist('user@notdpdns.org', ['dpdns.org'])).toBe(false)
  })

  it('does not match disallowed domains', () => {
    expect(isEmailInDenylist('user@gmail.com', ['dpdns.org', 'qzz.io'])).toBe(false)
    expect(isEmailInDenylist('user@example.com', ['dpdns.org'])).toBe(false)
  })

  it('handles multiple denylist entries', () => {
    const denylist = ['dpdns.org', 'qzz.io', 'cc.cd']
    expect(isEmailInDenylist('user@foo.dpdns.org', denylist)).toBe(true)
    expect(isEmailInDenylist('user@bar.qzz.io', denylist)).toBe(true)
    expect(isEmailInDenylist('user@baz.cc.cd', denylist)).toBe(true)
    expect(isEmailInDenylist('user@example.com', denylist)).toBe(false)
  })
})
