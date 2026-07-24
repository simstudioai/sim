/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildChallengeHost,
  buildTxtRecordValue,
  generateVerificationToken,
  SSO_CHALLENGE_HOST_PREFIX,
  toDomainResponse,
} from '@/lib/auth/sso/domain-verification'

describe('domain-verification helpers', () => {
  it('builds the challenge host on the underscore-prefixed label', () => {
    expect(buildChallengeHost('acme.com')).toBe(`${SSO_CHALLENGE_HOST_PREFIX}.acme.com`)
    expect(buildChallengeHost('eng.acme.com')).toBe('_sim-challenge.eng.acme.com')
  })

  it('prefixes the TXT value so it is unambiguous among other records', () => {
    expect(buildTxtRecordValue('abc123')).toBe('sim-domain-verification=abc123')
  })

  it('generates high-entropy, unique tokens', () => {
    const a = generateVerificationToken()
    const b = generateVerificationToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(32)
  })

  describe('toDomainResponse', () => {
    it('exposes the TXT value only for pending domains', () => {
      const pending = toDomainResponse({
        id: 'd1',
        domain: 'acme.com',
        status: 'pending',
        verificationToken: 'tok',
        verifiedAt: null,
      })
      expect(pending).toEqual({
        id: 'd1',
        domain: 'acme.com',
        status: 'pending',
        verifiedAt: null,
        challengeHost: '_sim-challenge.acme.com',
        txtRecordValue: 'sim-domain-verification=tok',
      })
    })

    it('redacts the pending TXT value when includeToken is false', () => {
      const redacted = toDomainResponse(
        {
          id: 'd1',
          domain: 'acme.com',
          status: 'pending',
          verificationToken: 'tok',
          verifiedAt: null,
        },
        { includeToken: false }
      )
      expect(redacted.status).toBe('pending')
      expect(redacted.txtRecordValue).toBeNull()
      expect(redacted.challengeHost).toBe('_sim-challenge.acme.com')
    })

    it('never leaks the token for a verified domain', () => {
      const verifiedAt = new Date('2026-07-23T00:00:00.000Z')
      const verified = toDomainResponse({
        id: 'd2',
        domain: 'acme.com',
        status: 'verified',
        verificationToken: 'secret',
        verifiedAt,
      })
      expect(verified.status).toBe('verified')
      expect(verified.txtRecordValue).toBeNull()
      expect(verified.verifiedAt).toBe(verifiedAt.toISOString())
    })
  })
})
