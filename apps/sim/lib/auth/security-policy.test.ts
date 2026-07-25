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
  getOrgSecurityRecord,
  getSecurityPolicyVersion,
  getSessionCookieCacheVersion,
  invalidateMembershipCache,
  invalidateOrgSecurityCache,
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

  describe('getOrgSecurityRecord', () => {
    it('serves the version and the session policy from ONE row read', async () => {
      const orgId = nextOrgId()
      queueTableRows(organization, [
        { version: 7, sessionPolicySettings: { maxSessionHours: 8, idleTimeoutHours: null } },
      ])

      const record = await getOrgSecurityRecord(orgId)

      expect(record.version).toBe(7)
      expect(record.sessionPolicySettings).toEqual({ maxSessionHours: 8, idleTimeoutHours: null })
      expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
    })

    it('reads the row once for a version lookup, then serves the policy from cache', async () => {
      const orgId = nextOrgId()
      queueTableRows(organization, [
        { version: 3, sessionPolicySettings: { maxSessionHours: 12, idleTimeoutHours: null } },
      ])

      // This is the coherence guarantee: whatever version a caller observed,
      // the policy it goes on to read came from that same row. Two independent
      // caches previously allowed a bumped version to pair with a stale policy.
      const version = await getSecurityPolicyVersion(orgId)
      const { sessionPolicySettings } = await getOrgSecurityRecord(orgId)

      expect(version).toBe(3)
      expect(sessionPolicySettings).toEqual({ maxSessionHours: 12, idleTimeoutHours: null })
      expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
    })

    it('re-reads after invalidation', async () => {
      const orgId = nextOrgId()
      queueTableRows(organization, [{ version: 1, sessionPolicySettings: null }])
      await getOrgSecurityRecord(orgId)

      invalidateOrgSecurityCache(orgId)
      queueTableRows(organization, [
        { version: 2, sessionPolicySettings: { maxSessionHours: 4, idleTimeoutHours: null } },
      ])

      const record = await getOrgSecurityRecord(orgId)
      expect(record.version).toBe(2)
      expect(record.sessionPolicySettings).toEqual({ maxSessionHours: 4, idleTimeoutHours: null })
      expect(dbChainMockFns.select).toHaveBeenCalledTimes(2)
    })

    it('re-reads when the caller bypasses the cache', async () => {
      const orgId = nextOrgId()
      queueTableRows(organization, [{ version: 1, sessionPolicySettings: null }])
      await getOrgSecurityRecord(orgId)

      queueTableRows(organization, [
        { version: 2, sessionPolicySettings: { maxSessionHours: 6, idleTimeoutHours: null } },
      ])
      const record = await getOrgSecurityRecord(orgId, { bypassCache: true })

      expect(record.sessionPolicySettings).toEqual({ maxSessionHours: 6, idleTimeoutHours: null })
      expect(dbChainMockFns.select).toHaveBeenCalledTimes(2)
    })

    it('serves the last known-good record when a refresh fails', async () => {
      const orgId = nextOrgId()
      queueTableRows(organization, [
        { version: 5, sessionPolicySettings: { maxSessionHours: 8, idleTimeoutHours: null } },
      ])
      await getOrgSecurityRecord(orgId)

      invalidateOrgSecurityCache(orgId)
      // A read failure must not silently drop the org's bounds — that would
      // disable a security control on a transient database blip.
      dbChainMockFns.limit.mockImplementationOnce(() => {
        throw new Error('connection reset')
      })

      // Nothing cached for this org after invalidation, so it falls to defaults.
      const cold = await getOrgSecurityRecord(orgId)
      expect(cold).toEqual({ version: 1, sessionPolicySettings: null })

      queueTableRows(organization, [
        { version: 5, sessionPolicySettings: { maxSessionHours: 8, idleTimeoutHours: null } },
      ])
      await getOrgSecurityRecord(orgId)
      dbChainMockFns.limit.mockImplementationOnce(() => {
        throw new Error('connection reset')
      })

      const warm = await getOrgSecurityRecord(orgId, { bypassCache: true })
      expect(warm.version).toBe(5)
      expect(warm.sessionPolicySettings).toEqual({ maxSessionHours: 8, idleTimeoutHours: null })
    })

    it('defaults an unknown organization to version 1 with no policy', async () => {
      queueTableRows(organization, [])
      expect(await getOrgSecurityRecord(nextOrgId())).toEqual({
        version: 1,
        sessionPolicySettings: null,
      })
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
  })

  describe('getSessionCookieCacheVersion', () => {
    it('embeds the org id so two orgs never share a version string', async () => {
      const userId = nextUserId()
      const orgId = nextOrgId()
      queueTableRows(member, [{ organizationId: orgId }])
      queueTableRows(organization, [{ version: 4, sessionPolicySettings: null }])

      expect(await getSessionCookieCacheVersion({ userId })).toBe(`${orgId}:4`)
    })

    it('returns the static default for org-less sessions', async () => {
      queueTableRows(member, [])
      expect(await getSessionCookieCacheVersion({ userId: nextUserId() })).toBe('none')
    })

    it('costs no lookups when organizations are disabled for the deployment', async () => {
      setEnvFlags({ isOrganizationsEnabled: false })
      expect(await getSessionCookieCacheVersion({ userId: nextUserId() })).toBe('none')
      expect(dbChainMockFns.select).not.toHaveBeenCalled()
    })
  })
})
