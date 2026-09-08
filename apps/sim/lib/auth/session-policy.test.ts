/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import { dbChainMockFns, resetDbChainMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MIN_IDLE_TIMEOUT_HOURS } from '@/lib/api/contracts/organization'
import { getMemberOrganizationId, invalidateMembershipCache } from '@/lib/auth/security-policy'
import {
  clampExpiryForSession,
  clampSessionExpiry,
  getSessionPolicy,
  invalidateSessionPolicyCache,
  type ResolvedSessionPolicy,
} from '@/lib/auth/session-policy'

const HOUR_MS = 60 * 60 * 1000

function policy(overrides: Partial<ResolvedSessionPolicy> = {}): ResolvedSessionPolicy {
  return { maxSessionHours: null, idleTimeoutHours: null, ...overrides }
}

describe('clampSessionExpiry', () => {
  const createdAt = new Date('2026-07-22T00:00:00Z')
  const now = new Date('2026-07-22T12:00:00Z')
  /** Better Auth's sliding refresh proposes now + 30 days. */
  const proposed = new Date(now.getTime() + 30 * 24 * HOUR_MS)

  it('returns the proposed time unchanged when no policy fields are set', () => {
    expect(clampSessionExpiry(policy(), createdAt, proposed, now).getTime()).toBe(
      proposed.getTime()
    )
  })

  it('caps absolute lifetime at createdAt + maxSessionHours', () => {
    const result = clampSessionExpiry(policy({ maxSessionHours: 24 }), createdAt, proposed, now)
    expect(result.getTime()).toBe(createdAt.getTime() + 24 * HOUR_MS)
  })

  it('re-clamps a sliding refresh that would stretch the session back out', () => {
    // 12h into a 24h-max session, a refresh proposing +30d must still end at
    // createdAt + 24h — this is the regression the update hook exists for.
    const midSession = new Date(createdAt.getTime() + 12 * HOUR_MS)
    const refreshProposal = new Date(midSession.getTime() + 30 * 24 * HOUR_MS)
    const result = clampSessionExpiry(
      policy({ maxSessionHours: 24 }),
      createdAt,
      refreshProposal,
      midSession
    )
    expect(result.getTime()).toBe(createdAt.getTime() + 24 * HOUR_MS)
  })

  it('caps idle expiry at now + idleTimeoutHours', () => {
    const result = clampSessionExpiry(policy({ idleTimeoutHours: 48 }), createdAt, proposed, now)
    expect(result.getTime()).toBe(now.getTime() + 48 * HOUR_MS)
  })

  it('floors idleTimeoutHours at twice the cookie-cache window', () => {
    const result = clampSessionExpiry(policy({ idleTimeoutHours: 1 }), createdAt, proposed, now)
    expect(result.getTime()).toBe(now.getTime() + MIN_IDLE_TIMEOUT_HOURS * HOUR_MS)
  })

  it('applies the stricter of max lifetime and idle timeout', () => {
    const result = clampSessionExpiry(
      policy({ maxSessionHours: 8760, idleTimeoutHours: 48 }),
      createdAt,
      proposed,
      now
    )
    expect(result.getTime()).toBe(now.getTime() + 48 * HOUR_MS)

    const nearEnd = new Date(createdAt.getTime() + 71 * HOUR_MS)
    const endOfLife = clampSessionExpiry(
      policy({ maxSessionHours: 72, idleTimeoutHours: 48 }),
      createdAt,
      new Date(nearEnd.getTime() + 30 * 24 * HOUR_MS),
      nearEnd
    )
    expect(endOfLife.getTime()).toBe(createdAt.getTime() + 72 * HOUR_MS)
  })

  it('never extends a proposal already shorter than the policy', () => {
    const shortProposal = new Date(now.getTime() + 1 * HOUR_MS)
    const result = clampSessionExpiry(
      policy({ maxSessionHours: 720, idleTimeoutHours: 720 }),
      createdAt,
      shortProposal,
      now
    )
    expect(result.getTime()).toBe(shortProposal.getTime())
  })
})

describe('transaction-scoped session policies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnvFlags({ isBillingEnabled: false, isSessionPoliciesEnabled: true })
    invalidateSessionPolicyCache('org-1')
    invalidateMembershipCache('user-1')
  })

  afterEach(() => {
    resetDbChainMock()
    resetEnvFlagsMock()
  })

  it('does not consume a cached policy or publish uncommitted policy changes', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ settings: { maxSessionHours: 24 } }])
    await expect(getSessionPolicy('org-1')).resolves.toMatchObject({ maxSessionHours: 24 })

    const limit = vi.fn().mockResolvedValue([{ settings: { maxSessionHours: 4 } }])
    const executor = {
      ...db,
      select: vi.fn().mockReturnValue({ from: () => ({ where: () => ({ limit }) }) }),
    }
    await expect(getSessionPolicy('org-1', executor)).resolves.toMatchObject({ maxSessionHours: 4 })
    await expect(getSessionPolicy('org-1')).resolves.toMatchObject({ maxSessionHours: 24 })
    expect(dbChainMockFns.limit).toHaveBeenCalledOnce()
  })

  it('sees a membership created in the transaction despite a cached non-member result', async () => {
    dbChainMockFns.limit.mockResolvedValue([])
    await expect(getMemberOrganizationId('user-1')).resolves.toBeNull()

    const limit = vi.fn()
    limit.mockResolvedValueOnce([{ organizationId: 'org-1' }])
    limit.mockResolvedValueOnce([{ settings: { maxSessionHours: 4 } }])
    const executor = {
      ...db,
      select: vi.fn().mockReturnValue({ from: () => ({ where: () => ({ limit }) }) }),
    }

    await expect(
      clampExpiryForSession(
        {
          userId: 'user-1',
          createdAt: new Date('2026-09-08T00:00:00Z'),
          expiresAt: new Date('2026-10-08T00:00:00Z'),
        },
        undefined,
        executor
      )
    ).resolves.toEqual(new Date('2026-09-08T04:00:00Z'))
    await expect(getMemberOrganizationId('user-1')).resolves.toBeNull()
    expect(dbChainMockFns.limit).toHaveBeenCalledOnce()
  })
})
