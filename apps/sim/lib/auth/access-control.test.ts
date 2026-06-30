/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccessControlConfig } from '@/lib/auth/access-control'

const { mockFetch, envRef, flagRef } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  envRef: {
    APPCONFIG_APPLICATION: 'sim-staging' as string | undefined,
    APPCONFIG_ENVIRONMENT: 'staging' as string | undefined,
    BLOCKED_SIGNUP_DOMAINS: undefined as string | undefined,
    BLOCKED_EMAILS: undefined as string | undefined,
    ALLOWED_LOGIN_EMAILS: undefined as string | undefined,
    ALLOWED_LOGIN_DOMAINS: undefined as string | undefined,
    BLOCKED_EMAIL_MX_HOSTS: undefined as string | undefined,
  },
  flagRef: { isAppConfigEnabled: false },
}))

vi.mock('@/lib/core/config/appconfig', () => ({
  fetchAppConfigProfile: mockFetch,
}))

vi.mock('@/lib/core/config/env', () => ({
  get env() {
    return envRef
  },
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  get isAppConfigEnabled() {
    return flagRef.isAppConfigEnabled
  },
}))

import {
  getAccessControlConfig,
  isEmailBlockedByAccessControl,
  isEmailInDenylist,
} from '@/lib/auth/access-control'

const empty: AccessControlConfig = {
  blockedSignupDomains: [],
  blockedEmails: [],
  allowedLoginEmails: [],
  allowedLoginDomains: [],
  blockedEmailMxHosts: [],
}

describe('getAccessControlConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    flagRef.isAppConfigEnabled = false
    Object.assign(envRef, {
      BLOCKED_SIGNUP_DOMAINS: undefined,
      BLOCKED_EMAILS: undefined,
      ALLOWED_LOGIN_EMAILS: undefined,
      ALLOWED_LOGIN_DOMAINS: undefined,
      BLOCKED_EMAIL_MX_HOSTS: undefined,
    })
  })

  describe('env fallback (AppConfig disabled)', () => {
    it('returns empty lists when nothing is set', async () => {
      expect(await getAccessControlConfig()).toEqual(empty)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('parses, trims, lowercases, and dedupes csv env vars', async () => {
      envRef.BLOCKED_SIGNUP_DOMAINS = 'Gmail.com, yahoo.com ,gmail.com,'
      envRef.BLOCKED_EMAILS = 'Spam@Evil.com, spam@evil.com'
      envRef.ALLOWED_LOGIN_DOMAINS = 'Sim.ai'
      const result = await getAccessControlConfig()
      expect(result.blockedSignupDomains).toEqual(['gmail.com', 'yahoo.com'])
      expect(result.blockedEmails).toEqual(['spam@evil.com'])
      expect(result.allowedLoginDomains).toEqual(['sim.ai'])
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('AppConfig source (enabled)', () => {
    beforeEach(() => {
      flagRef.isAppConfigEnabled = true
    })

    it('reads the access-control profile and normalizes the payload', async () => {
      mockFetch.mockImplementation((_ids, parse) =>
        Promise.resolve(
          parse({
            blockedSignupDomains: ['X.com'],
            allowedLoginDomains: ['sim.ai'],
            blockedEmailMxHosts: 'not-an-array',
          })
        )
      )

      const result = await getAccessControlConfig()
      expect(result.blockedSignupDomains).toEqual(['x.com'])
      expect(result.allowedLoginDomains).toEqual(['sim.ai'])
      expect(result.blockedEmailMxHosts).toEqual([])
      expect(mockFetch).toHaveBeenCalledWith(
        { application: 'sim-staging', environment: 'staging', profile: 'access-control' },
        expect.any(Function)
      )
    })

    it('falls back to env vars when the fetch yields null', async () => {
      envRef.BLOCKED_SIGNUP_DOMAINS = 'spam.example'
      mockFetch.mockResolvedValue(null)
      const result = await getAccessControlConfig()
      expect(result.blockedSignupDomains).toEqual(['spam.example'])
    })
  })
})

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

describe('isEmailBlockedByAccessControl', () => {
  const config: AccessControlConfig = {
    ...empty,
    blockedSignupDomains: ['bad.com'],
    blockedEmails: ['spam@evil.com'],
  }

  it('matches individually blocked emails case-insensitively', () => {
    expect(isEmailBlockedByAccessControl('spam@evil.com', config)).toBe(true)
    expect(isEmailBlockedByAccessControl(' Spam@Evil.com ', config)).toBe(true)
    expect(isEmailBlockedByAccessControl('other@evil.com', config)).toBe(false)
  })

  it('matches blocked domains and subdomains', () => {
    expect(isEmailBlockedByAccessControl('a@bad.com', config)).toBe(true)
    expect(isEmailBlockedByAccessControl('a@mail.bad.com', config)).toBe(true)
    expect(isEmailBlockedByAccessControl('a@good.com', config)).toBe(false)
  })

  it('returns false for missing emails and empty config', () => {
    expect(isEmailBlockedByAccessControl(null, config)).toBe(false)
    expect(isEmailBlockedByAccessControl(undefined, config)).toBe(false)
    expect(isEmailBlockedByAccessControl('a@bad.com', empty)).toBe(false)
  })
})
