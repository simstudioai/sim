/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getInstanceUrl } from '@/tools/salesforce/utils'

/** Builds an unsigned JWT carrying the given payload, which is all the decoder reads. */
function idTokenWith(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode(payload)}.sig`
}

describe('getInstanceUrl', () => {
  const ORG = 'https://acme.my.salesforce.com'
  const SANDBOX_ORG = 'https://acme--sbx.sandbox.my.salesforce.com'

  it('prefers an explicitly provided instance URL', () => {
    expect(getInstanceUrl(idTokenWith({ profile: `${ORG}/profile` }), SANDBOX_ORG)).toBe(
      SANDBOX_ORG
    )
  })

  it('reads the org host from the profile claim', () => {
    expect(getInstanceUrl(idTokenWith({ profile: `${ORG}/00530000009M943` }))).toBe(ORG)
  })

  it('reads the org host from the sub claim', () => {
    expect(getInstanceUrl(idTokenWith({ sub: `${SANDBOX_ORG}/id/00D/005` }))).toBe(SANDBOX_ORG)
  })

  // `sub` on a Salesforce id token is rooted at the *authorization server* when
  // no org can be resolved. Calling /services/data against a login host always
  // fails, so neither host may be mistaken for an instance URL — test.salesforce.com
  // included, or every sandbox credential would call the wrong host.
  it.each([
    ['production login host', 'https://login.salesforce.com'],
    ['sandbox login host', 'https://test.salesforce.com'],
  ])('rejects the %s in the sub claim', (_label, loginOrigin) => {
    expect(() => getInstanceUrl(idTokenWith({ sub: `${loginOrigin}/id/00D/005` }))).toThrow(
      'Salesforce instance URL is required'
    )
  })

  it.each([
    ['production login host', 'https://login.salesforce.com'],
    ['sandbox login host', 'https://test.salesforce.com'],
  ])('rejects the %s in the profile claim', (_label, loginOrigin) => {
    expect(() =>
      getInstanceUrl(idTokenWith({ profile: `${loginOrigin}/00530000009M943` }))
    ).toThrow('Salesforce instance URL is required')
  })

  it('falls through to sub when profile is rooted at a login host', () => {
    // `profile` is normally org-rooted and `sub` login-rooted, but the reverse
    // occurs; an `else if` here would abandon the lookup on the first claim.
    expect(
      getInstanceUrl(
        idTokenWith({
          profile: 'https://test.salesforce.com/005',
          sub: `${SANDBOX_ORG}/id/00D/005`,
        })
      )
    ).toBe(SANDBOX_ORG)
  })

  it('throws when neither an instance URL nor a decodable token is available', () => {
    expect(() => getInstanceUrl()).toThrow('Salesforce instance URL is required')
    expect(() => getInstanceUrl('not-a-jwt')).toThrow('Salesforce instance URL is required')
  })
})
