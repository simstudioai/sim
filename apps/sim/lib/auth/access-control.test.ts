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

vi.mock('@/lib/core/config/feature-flags', () => ({
  get isAppConfigEnabled() {
    return flagRef.isAppConfigEnabled
  },
}))

import { getAccessControlConfig } from '@/lib/auth/access-control'

const empty: AccessControlConfig = {
  blockedSignupDomains: [],
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
      envRef.ALLOWED_LOGIN_DOMAINS = 'Sim.ai'
      const result = await getAccessControlConfig()
      expect(result.blockedSignupDomains).toEqual(['gmail.com', 'yahoo.com'])
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
