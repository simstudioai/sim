/**
 * @vitest-environment node
 */
import { member, organization } from '@sim/db/schema'
import {
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  setEnvFlags,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getMemberOrganizationId,
  getSecurityPolicyVersion,
  getSessionCookieCacheVersion,
  invalidateMembershipCache,
  invalidateSecurityPolicyVersionCache,
} from '@/lib/auth/security-policy'

/** Module-level caches persist across cases, so every case uses a fresh id. */
let idCounter = 0
const nextOrgId = () => `org-${++idCounter}`
const nextUserId = () => `user-${++idCounter}`

afterAll(resetEnvFlagsMock)

describe('security policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnvFlags({ isOrganizationsEnabled: true })
  })

  describe('getSecurityPolicyVersion', () => {
    it('caches the version and re-reads after invalidation', async () => {
      const orgId = nextOrgId()
      queueTableRows(organization, [{ version: 3 }])

      expect(await getSecurityPolicyVersion(orgId)).toBe(3)
      expect(await getSecurityPolicyVersion(orgId)).toBe(3)
      expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)

      invalidateSecurityPolicyVersionCache(orgId)
      queueTableRows(organization, [{ version: 4 }])
      expect(await getSecurityPolicyVersion(orgId)).toBe(4)
    })

    it('returns the default without querying for an org-less session', async () => {
      expect(await getSecurityPolicyVersion(null)).toBe(1)
      expect(dbChainMockFns.select).not.toHaveBeenCalled()
    })

    it('defaults an unknown organization to version 1', async () => {
      queueTableRows(organization, [])
      expect(await getSecurityPolicyVersion(nextOrgId())).toBe(1)
    })

    it('never lets a late read overwrite a newer version', async () => {
      const orgId = nextOrgId()
      queueTableRows(organization, [{ version: 9 }])
      expect(await getSecurityPolicyVersion(orgId)).toBe(9)

      invalidateSecurityPolicyVersionCache(orgId)
      queueTableRows(organization, [{ version: 9 }])
      await getSecurityPolicyVersion(orgId)
      // A read that started before the bump resolving late must not re-seed the
      // pre-bump value and delay cookie invalidation another TTL.
      invalidateSecurityPolicyVersionCache(orgId)
      queueTableRows(organization, [{ version: 10 }])
      expect(await getSecurityPolicyVersion(orgId)).toBe(10)
      queueTableRows(organization, [{ version: 9 }])
      expect(await getSecurityPolicyVersion(orgId)).toBe(10)
    })

    it('falls back to the default when the read fails', async () => {
      dbChainMockFns.limit.mockImplementationOnce(() => {
        throw new Error('connection reset')
      })
      // Erring low only costs a cookie mismatch and a database session read —
      // it can never suppress a revocation the way a stale-high value would.
      expect(await getSecurityPolicyVersion(nextOrgId())).toBe(1)
    })
  })

  describe('getMemberOrganizationId', () => {
    it('returns null without querying for an anonymous session', async () => {
      expect(await getMemberOrganizationId(null)).toBeNull()
      expect(dbChainMockFns.select).not.toHaveBeenCalled()
    })

    it('caches a positive membership and re-reads after invalidation', async () => {
      const userId = nextUserId()
      queueTableRows(member, [{ organizationId: 'org-a' }])

      expect(await getMemberOrganizationId(userId)).toBe('org-a')
      expect(await getMemberOrganizationId(userId)).toBe('org-a')
      expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)

      invalidateMembershipCache(userId)
      queueTableRows(member, [{ organizationId: 'org-b' }])
      expect(await getMemberOrganizationId(userId)).toBe('org-b')
    })

    it('propagates a read failure so callers can tell it apart from "no org"', async () => {
      dbChainMockFns.limit.mockImplementationOnce(() => {
        throw new Error('connection reset')
      })
      await expect(getMemberOrganizationId(nextUserId())).rejects.toThrow('connection reset')
    })
  })

  describe('getSessionCookieCacheVersion', () => {
    it('embeds the org id so two orgs never share a version string', async () => {
      const userId = nextUserId()
      const orgId = nextOrgId()
      queueTableRows(member, [{ organizationId: orgId }])
      queueTableRows(organization, [{ version: 4 }])

      expect(await getSessionCookieCacheVersion({ userId })).toBe(`${orgId}:4`)
    })

    it('returns the static default for org-less sessions', async () => {
      queueTableRows(member, [])
      expect(await getSessionCookieCacheVersion({ userId: nextUserId() })).toBe('none')
    })

    it('never throws on a failed membership read', async () => {
      dbChainMockFns.limit.mockImplementationOnce(() => {
        throw new Error('connection reset')
      })
      // Runs on every authenticated request — a throw here would 500 the app.
      expect(await getSessionCookieCacheVersion({ userId: nextUserId() })).toBe('none')
    })

    it('costs no lookups when organizations are disabled for the deployment', async () => {
      setEnvFlags({ isOrganizationsEnabled: false })
      expect(await getSessionCookieCacheVersion({ userId: nextUserId() })).toBe('none')
      expect(dbChainMockFns.select).not.toHaveBeenCalled()
    })
  })
})
