import { parse } from 'tldts'
import { describe, expect, it } from 'vitest'
import { isDisposableEmail } from '@/lib/messaging/email/disposable'
import disposableDomains from '@/lib/messaging/email/disposable-email-domains.json'

describe('isDisposableEmail', () => {
  it.each([
    ['a listed provider', 'jane@mailinator.com'],
    ['a subdomain of a listed provider', 'jane@inbox.mailinator.com'],
    ['a listed provider in mixed case', 'Jane@MailInator.COM'],
    ['a fully qualified domain with a trailing dot', 'jane@mailinator.com.'],
    ['a quoted local part that contains @', '"jane@work.com"@mailinator.com'],
  ])('refuses %s', async (_case, email) => {
    expect(await isDisposableEmail(email)).toBe(true)
  })

  it.each([
    ['a company under a public suffix', 'jane@company.msk.ru'],
    ['a company under a private-section suffix', 'jane@acme.it.com'],
    ['a dynamic-DNS host under a shared suffix', 'jane@office.dyndns.org'],
    ['a hosting company the aggressive list carried', 'jane@railway.com'],
    ['a regional ISP the curated list carried', 'jane@21cn.com'],
    ['a forwarding relay alias', 'jane@maskmy.id'],
    ['an Apple private relay alias', 'x1y2@privaterelay.appleid.com'],
    ['a mainstream provider', 'jane@gmail.com'],
  ])('allows %s', async (_case, email) => {
    expect(await isDisposableEmail(email)).toBe(false)
  })

  it.each([null, undefined, '', 'jane', 'jane@', 'jane@.'])(
    'allows the unparsable %j',
    async (email) => {
      expect(await isDisposableEmail(email)).toBe(false)
    }
  )
})

describe('disposable-email-domains.json', () => {
  /**
   * The matcher also checks every parent of the email's domain, so a public suffix in the list
   * (`msk.ru`, `dyndns.org`) would refuse every organization registered under it.
   */
  it('carries no public suffix', () => {
    const suffixes = disposableDomains.filter(
      (entry) => parse(entry, { allowPrivateDomains: true }).domain === null
    )
    expect(suffixes).toEqual([])
  })
})
