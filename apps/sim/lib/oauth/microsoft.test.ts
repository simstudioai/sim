import { describe, expect, it } from 'vitest'
import { deriveMicrosoftEmailVerified, mapMicrosoftProfileToUser } from '@/lib/oauth/microsoft'

const EMAIL = 'user@contoso.com'

describe('mapMicrosoftProfileToUser', () => {
  it('marks the email verified when Entra asserts domain ownership', () => {
    expect(mapMicrosoftProfileToUser({ email: EMAIL, xms_edov: true })).toEqual({
      emailVerified: true,
    })
  })

  it('accepts the string and numeric encodings Entra uses for xms_edov', () => {
    for (const edov of ['true', '1', 1]) {
      expect(mapMicrosoftProfileToUser({ email: EMAIL, xms_edov: edov })).toEqual({
        emailVerified: true,
      })
    }
  })

  /** nOAuth: a hostile tenant can set `email` but cannot verify the domain. */
  it('does not vouch for an email the tenant has not verified', () => {
    expect(mapMicrosoftProfileToUser({ email: 'victim@target.com' })).toEqual({})
    expect(mapMicrosoftProfileToUser({ email: 'victim@target.com', xms_edov: false })).toEqual({})
    expect(mapMicrosoftProfileToUser({ email: 'victim@target.com', xms_edov: '0' })).toEqual({})
  })

  /** The spread must leave `emailVerified` alone, not force it to `false`. */
  it('returns no key at all when unverified, so it can never downgrade', () => {
    expect('emailVerified' in mapMicrosoftProfileToUser({ email: EMAIL })).toBe(false)
  })
})

describe('deriveMicrosoftEmailVerified', () => {
  it('honors an explicit email_verified=true claim', () => {
    expect(deriveMicrosoftEmailVerified({ email_verified: true }, EMAIL)).toBe(true)
  })

  it('honors an explicit email_verified=false claim over verified-email claims', () => {
    expect(
      deriveMicrosoftEmailVerified(
        { email_verified: false, verified_primary_email: [EMAIL] },
        EMAIL
      )
    ).toBe(false)
  })

  it('treats a verified primary email matching the email as verified', () => {
    expect(deriveMicrosoftEmailVerified({ verified_primary_email: [EMAIL] }, EMAIL)).toBe(true)
  })

  it('treats a verified secondary email matching the email as verified', () => {
    expect(
      deriveMicrosoftEmailVerified({ verified_secondary_email: ['x@y.com', EMAIL] }, EMAIL)
    ).toBe(true)
  })

  it('does not verify when the verified-email claims do not include the email', () => {
    expect(
      deriveMicrosoftEmailVerified(
        {
          verified_primary_email: ['other@contoso.com'],
          verified_secondary_email: ['another@contoso.com'],
        },
        EMAIL
      )
    ).toBe(false)
  })

  it('defaults to false when no verification claim is present (typical Azure AD token)', () => {
    expect(deriveMicrosoftEmailVerified({ name: 'User', oid: 'abc' }, EMAIL)).toBe(false)
  })

  it('coerces a truthy non-boolean email_verified claim', () => {
    expect(deriveMicrosoftEmailVerified({ email_verified: 'true' }, EMAIL)).toBe(true)
  })

  it('treats malformed (non-array) verified-email claims as unverified without throwing', () => {
    expect(deriveMicrosoftEmailVerified({ verified_primary_email: 'not-an-array' }, EMAIL)).toBe(
      false
    )
    expect(deriveMicrosoftEmailVerified({ verified_primary_email: 123 }, EMAIL)).toBe(false)
  })

  it('does not treat a string claim equal to the email as verified (guards the old unsafe cast)', () => {
    expect(deriveMicrosoftEmailVerified({ verified_primary_email: EMAIL }, EMAIL)).toBe(false)
    expect(deriveMicrosoftEmailVerified({ verified_secondary_email: EMAIL }, EMAIL)).toBe(false)
  })
})
