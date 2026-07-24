/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveTxt, mockSetServers } = vi.hoisted(() => ({
  mockResolveTxt: vi.fn(),
  mockSetServers: vi.fn(),
}))

vi.mock('node:dns/promises', () => ({
  Resolver: class {
    resolveTxt = mockResolveTxt
    setServers = mockSetServers
  },
}))

import {
  buildChallengeHost,
  buildTxtRecordValue,
  checkDomainTxtRecord,
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

  describe('checkDomainTxtRecord', () => {
    const TOKEN = 'tok-123'
    const EXPECTED = buildTxtRecordValue(TOKEN)

    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('queries the challenge host for the domain', async () => {
      mockResolveTxt.mockResolvedValue([[EXPECTED]])
      await checkDomainTxtRecord('acme.com', TOKEN)
      expect(mockResolveTxt).toHaveBeenCalledWith('_sim-challenge.acme.com')
    })

    it('verifies when the exact value is published', async () => {
      mockResolveTxt.mockResolvedValue([[EXPECTED]])
      await expect(checkDomainTxtRecord('acme.com', TOKEN)).resolves.toBe(true)
    })

    it('joins a value split across 255-char chunks before comparing', async () => {
      const midpoint = Math.floor(EXPECTED.length / 2)
      mockResolveTxt.mockResolvedValue([[EXPECTED.slice(0, midpoint), EXPECTED.slice(midpoint)]])
      await expect(checkDomainTxtRecord('acme.com', TOKEN)).resolves.toBe(true)
    })

    it('finds the match among unrelated TXT records on the same host', async () => {
      mockResolveTxt.mockResolvedValue([
        ['v=spf1 include:_spf.google.com ~all'],
        ['facebook-domain-verification=abc123'],
        [EXPECTED],
      ])
      await expect(checkDomainTxtRecord('acme.com', TOKEN)).resolves.toBe(true)
    })

    it('tolerates padding a DNS panel added around the value', async () => {
      mockResolveTxt.mockResolvedValue([[`  ${EXPECTED}  `]])
      await expect(checkDomainTxtRecord('acme.com', TOKEN)).resolves.toBe(true)
    })

    it('rejects a near-miss value (no partial or prefix match)', async () => {
      mockResolveTxt.mockResolvedValue([[`${EXPECTED}extra`], [EXPECTED.slice(0, -1)]])
      await expect(checkDomainTxtRecord('acme.com', TOKEN)).resolves.toBe(false)
    })

    it('rejects another org token published on the same host', async () => {
      mockResolveTxt.mockResolvedValue([[buildTxtRecordValue('someone-elses-token')]])
      await expect(checkDomainTxtRecord('acme.com', TOKEN)).resolves.toBe(false)
    })

    it('returns false (never throws) when the record is absent', async () => {
      mockResolveTxt.mockRejectedValue(Object.assign(new Error('no data'), { code: 'ENODATA' }))
      await expect(checkDomainTxtRecord('acme.com', TOKEN)).resolves.toBe(false)
    })

    it('returns false (never throws) when resolution fails for an infrastructure reason', async () => {
      mockResolveTxt.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' }))
      await expect(checkDomainTxtRecord('acme.com', TOKEN)).resolves.toBe(false)
    })

    it('returns false when the host has no TXT records at all', async () => {
      mockResolveTxt.mockResolvedValue([])
      await expect(checkDomainTxtRecord('acme.com', TOKEN)).resolves.toBe(false)
    })
  })
})
