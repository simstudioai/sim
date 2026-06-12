/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isDisposableEmailDomain } from '@/lib/messaging/email/disposable-domains.server'

describe('isDisposableEmailDomain', () => {
  it('flags a known disposable domain', () => {
    expect(isDisposableEmailDomain('someone@mailinator.com')).toBe(true)
  })

  it('flags a subdomain of a wildcard base domain', () => {
    expect(isDisposableEmailDomain('someone@inbox.10mail.org')).toBe(true)
  })

  it('is case-insensitive on the domain', () => {
    expect(isDisposableEmailDomain('Someone@MailInator.com')).toBe(true)
  })

  it('allows a normal provider domain', () => {
    expect(isDisposableEmailDomain('someone@gmail.com')).toBe(false)
  })

  it('allows a custom catch-all domain that is not on the list', () => {
    expect(isDisposableEmailDomain('sim6dc088f506@lordfortescue.org.uk')).toBe(false)
  })

  it('returns false for malformed input with no domain', () => {
    expect(isDisposableEmailDomain('not-an-email')).toBe(false)
  })
})
