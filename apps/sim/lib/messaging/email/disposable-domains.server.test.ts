/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isDisposableEmailDomain } from '@/lib/messaging/email/disposable-domains.server'

describe('isDisposableEmailDomain', () => {
  it('flags a known disposable domain', async () => {
    expect(await isDisposableEmailDomain('someone@mailinator.com')).toBe(true)
  })

  it('flags a subdomain of a wildcard base domain', async () => {
    expect(await isDisposableEmailDomain('someone@inbox.10mail.org')).toBe(true)
  })

  it('flags the bare wildcard base domain itself', async () => {
    expect(await isDisposableEmailDomain('someone@10mail.org')).toBe(true)
  })

  it('is case-insensitive on the domain', async () => {
    expect(await isDisposableEmailDomain('Someone@MailInator.com')).toBe(true)
  })

  it('allows a normal provider domain', async () => {
    expect(await isDisposableEmailDomain('someone@gmail.com')).toBe(false)
  })

  it('allows a custom catch-all domain that is not on the list', async () => {
    expect(await isDisposableEmailDomain('sim6dc088f506@lordfortescue.org.uk')).toBe(false)
  })

  it('returns false for malformed input with no domain', async () => {
    expect(await isDisposableEmailDomain('not-an-email')).toBe(false)
  })
})
