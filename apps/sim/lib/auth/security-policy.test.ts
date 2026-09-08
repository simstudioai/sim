/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getMemberOrganizationId,
  getSecurityPolicyVersion,
  getSessionCookieCacheVersion,
  invalidateMembershipCache,
  invalidateSecurityPolicyVersionCache,
  membershipCacheTtlMs,
  NEGATIVE_MEMBERSHIP_CACHE_TTL_MS,
  SECURITY_POLICY_VERSION_CACHE_TTL_MS,
} from '@/lib/auth/security-policy'

afterAll(resetDbChainMock)

describe('membershipCacheTtlMs', () => {
  /**
   * The asymmetry is a security property: a cached `null` lets a user dodge a
   * new org's policy until it expires, and they can join through paths this
   * codebase never sees (Better Auth SSO JIT provisioning). A positive result
   * only changes through leave/transfer, which invalidate explicitly.
   */
  it('expires a non-member result far sooner than a member one', () => {
    expect(membershipCacheTtlMs('org-1')).toBe(SECURITY_POLICY_VERSION_CACHE_TTL_MS)
    expect(membershipCacheTtlMs(null)).toBe(NEGATIVE_MEMBERSHIP_CACHE_TTL_MS)
    expect(membershipCacheTtlMs(null)).toBeLessThan(membershipCacheTtlMs('org-1'))
  })
})

describe('getMemberOrganizationId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    invalidateMembershipCache('user-1')
  })

  it('serves a repeat lookup from cache instead of re-reading membership', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ organizationId: 'org-1' }])

    await expect(getMemberOrganizationId('user-1')).resolves.toBe('org-1')
    await expect(getMemberOrganizationId('user-1')).resolves.toBe('org-1')

    expect(dbChainMockFns.limit).toHaveBeenCalledTimes(1)
  })

  /** `null` is a real answer, not a miss — re-querying every time would defeat the cache. */
  it('caches a non-member result too', async () => {
    dbChainMockFns.limit.mockResolvedValue([])

    await expect(getMemberOrganizationId('user-1')).resolves.toBeNull()
    await expect(getMemberOrganizationId('user-1')).resolves.toBeNull()

    expect(dbChainMockFns.limit).toHaveBeenCalledTimes(1)
  })

  it('re-reads after an explicit invalidation', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ organizationId: 'org-1' }])
    await expect(getMemberOrganizationId('user-1')).resolves.toBe('org-1')

    invalidateMembershipCache('user-1')
    dbChainMockFns.limit.mockResolvedValue([{ organizationId: 'org-2' }])

    await expect(getMemberOrganizationId('user-1')).resolves.toBe('org-2')
    expect(dbChainMockFns.limit).toHaveBeenCalledTimes(2)
  })

  it('treats a failed read as org-less without caching it', async () => {
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(getMemberOrganizationId('user-1')).resolves.toBeNull()

    dbChainMockFns.limit.mockResolvedValue([{ organizationId: 'org-1' }])
    await expect(getMemberOrganizationId('user-1')).resolves.toBe('org-1')
  })

  it('returns null for an absent user without touching the database', async () => {
    await expect(getMemberOrganizationId(null)).resolves.toBeNull()
    expect(dbChainMockFns.limit).not.toHaveBeenCalled()
  })
})

describe('getSecurityPolicyVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    invalidateSecurityPolicyVersionCache('org-1')
  })

  /** The value is a number, so a truthiness check would re-query on every read. */
  it('serves a repeat lookup from cache', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ version: 7 }])

    await expect(getSecurityPolicyVersion('org-1')).resolves.toBe(7)
    await expect(getSecurityPolicyVersion('org-1')).resolves.toBe(7)

    expect(dbChainMockFns.limit).toHaveBeenCalledTimes(1)
  })

  it('re-reads after an explicit invalidation', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ version: 7 }])
    await expect(getSecurityPolicyVersion('org-1')).resolves.toBe(7)

    invalidateSecurityPolicyVersionCache('org-1')
    dbChainMockFns.limit.mockResolvedValue([{ version: 8 }])

    await expect(getSecurityPolicyVersion('org-1')).resolves.toBe(8)
  })

  it('falls back to the default version without caching a failed read', async () => {
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(getSecurityPolicyVersion('org-1')).resolves.toBe(1)

    dbChainMockFns.limit.mockResolvedValue([{ version: 9 }])
    await expect(getSecurityPolicyVersion('org-1')).resolves.toBe(9)
  })

  it('returns the default for an org-less session without touching the database', async () => {
    await expect(getSecurityPolicyVersion(null)).resolves.toBe(1)
    expect(dbChainMockFns.limit).not.toHaveBeenCalled()
  })
})

describe('getSessionCookieCacheVersion', () => {
  it('reads membership and policy version from the transaction without contaminating shared caches', async () => {
    vi.clearAllMocks()
    resetDbChainMock()
    invalidateMembershipCache('cookie-user')
    invalidateSecurityPolicyVersionCache('cookie-org')
    dbChainMockFns.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ version: 7 }])
    await expect(getMemberOrganizationId('cookie-user')).resolves.toBeNull()
    await expect(getSecurityPolicyVersion('cookie-org')).resolves.toBe(7)

    const limit = vi
      .fn()
      .mockResolvedValueOnce([{ organizationId: 'cookie-org' }])
      .mockResolvedValueOnce([{ version: 8 }])
    const executor = {
      ...db,
      select: vi.fn().mockReturnValue({ from: () => ({ where: () => ({ limit }) }) }),
    }

    await expect(getSessionCookieCacheVersion({ userId: 'cookie-user' }, executor)).resolves.toBe(
      'cookie-org:8'
    )
    await expect(getSessionCookieCacheVersion({ userId: 'cookie-user' })).resolves.toBe('none')
    await expect(getSecurityPolicyVersion('cookie-org')).resolves.toBe(7)
    expect(dbChainMockFns.limit).toHaveBeenCalledTimes(2)
    expect(limit).toHaveBeenCalledTimes(2)
  })
})
