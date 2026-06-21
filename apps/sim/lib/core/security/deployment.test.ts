/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isEmailAllowed } from '@/lib/core/security/deployment'

describe('isEmailAllowed', () => {
  it('matches an exact email regardless of casing on either side', () => {
    expect(isEmailAllowed('user@acme.com', ['user@acme.com'])).toBe(true)
    expect(isEmailAllowed('User@Acme.com', ['user@acme.com'])).toBe(true)
    expect(isEmailAllowed('user@acme.com', ['USER@ACME.COM'])).toBe(true)
    expect(isEmailAllowed('  User@Acme.com  ', ['user@acme.com'])).toBe(true)
  })

  it('matches a domain pattern regardless of casing (covers IdP/session emails)', () => {
    expect(isEmailAllowed('User@Acme.com', ['@acme.com'])).toBe(true)
    expect(isEmailAllowed('user@acme.com', ['@Acme.com'])).toBe(true)
  })

  it('rejects emails not on the allow-list', () => {
    expect(isEmailAllowed('user@evil.com', ['user@acme.com', '@acme.com'])).toBe(false)
    expect(isEmailAllowed('user@acme.com', [])).toBe(false)
  })
})
