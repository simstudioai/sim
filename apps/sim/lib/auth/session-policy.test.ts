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
import { MIN_IDLE_TIMEOUT_HOURS } from '@/lib/api/contracts/organization'
import {
  clampExpiryForSession,
  clampSessionExpiry,
  getSessionPolicy,
  type ResolvedSessionPolicy,
} from '@/lib/auth/session-policy'

const { mockResolveEnterprisePlan } = vi.hoisted(() => ({
  mockResolveEnterprisePlan: vi.fn(),
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  resolveOrganizationEnterprisePlan: mockResolveEnterprisePlan,
}))

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

/** Module-level caches persist across cases, so every case uses a fresh id. */
let idCounter = 0
const nextOrgId = () => `sp-org-${++idCounter}`

afterAll(resetEnvFlagsMock)

describe('getSessionPolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnvFlags({ isBillingEnabled: true, isOrganizationsEnabled: true })
    mockResolveEnterprisePlan.mockResolvedValue(true)
  })

  it('returns no policy for an org-less session without touching the database', async () => {
    expect(await getSessionPolicy(null)).toEqual({
      maxSessionHours: null,
      idleTimeoutHours: null,
    })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('skips the entitlement check when the org has no bounds stored', async () => {
    queueTableRows(organization, [{ version: 1, sessionPolicySettings: null }])
    expect(await getSessionPolicy(nextOrgId())).toEqual({
      maxSessionHours: null,
      idleTimeoutHours: null,
    })
    expect(mockResolveEnterprisePlan).not.toHaveBeenCalled()
  })

  it('stops enforcing stored bounds for an org that is no longer entitled', async () => {
    queueTableRows(organization, [
      { version: 1, sessionPolicySettings: { maxSessionHours: 8, idleTimeoutHours: null } },
    ])
    mockResolveEnterprisePlan.mockResolvedValue(false)

    expect(await getSessionPolicy(nextOrgId())).toEqual({
      maxSessionHours: null,
      idleTimeoutHours: null,
    })
  })

  it('keeps enforcing when the entitlement check itself fails', async () => {
    queueTableRows(organization, [
      { version: 1, sessionPolicySettings: { maxSessionHours: 8, idleTimeoutHours: null } },
    ])
    // Stored bounds are only writable by an entitled org, so a failed plan read
    // must not be mistaken for a downgrade and silently disable enforcement.
    mockResolveEnterprisePlan.mockRejectedValue(new Error('billing unavailable'))

    expect(await getSessionPolicy(nextOrgId())).toEqual({
      maxSessionHours: 8,
      idleTimeoutHours: null,
    })
  })
})

describe('clampExpiryForSession', () => {
  const createdAt = new Date('2026-07-22T00:00:00Z')
  const proposed = new Date('2026-08-21T00:00:00Z')

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnvFlags({ isBillingEnabled: true, isOrganizationsEnabled: true })
    mockResolveEnterprisePlan.mockResolvedValue(true)
  })

  it('exempts impersonation sessions from the clamp', async () => {
    const result = await clampExpiryForSession({
      userId: 'user-1',
      impersonatedBy: 'platform-admin-1',
      createdAt,
      expiresAt: proposed,
    })

    expect(result?.getTime()).toBe(proposed.getTime())
    // Exempt before any lookup — impersonation must not even resolve a policy.
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('returns undefined when the session carries no expiry', async () => {
    expect(await clampExpiryForSession({ userId: 'user-1', createdAt })).toBeUndefined()
  })

  it('leaves non-member sessions untouched', async () => {
    queueTableRows(member, [])
    const result = await clampExpiryForSession({
      userId: 'user-1',
      createdAt,
      expiresAt: proposed,
    })
    expect(result?.getTime()).toBe(proposed.getTime())
  })

  it('clamps against the org resolved from membership', async () => {
    const orgId = nextOrgId()
    queueTableRows(member, [{ organizationId: orgId }])
    queueTableRows(organization, [
      { version: 1, sessionPolicySettings: { maxSessionHours: 24, idleTimeoutHours: null } },
    ])

    const result = await clampExpiryForSession({
      userId: `user-${orgId}`,
      createdAt,
      expiresAt: proposed,
    })

    expect(result?.getTime()).toBe(createdAt.getTime() + 24 * 60 * 60 * 1000)
  })

  it('skips the membership lookup when the caller already resolved it', async () => {
    const orgId = nextOrgId()
    queueTableRows(organization, [
      { version: 1, sessionPolicySettings: { maxSessionHours: 24, idleTimeoutHours: null } },
    ])

    const result = await clampExpiryForSession(
      { userId: 'user-fresh', createdAt, expiresAt: proposed },
      orgId
    )

    expect(result?.getTime()).toBe(createdAt.getTime() + 24 * 60 * 60 * 1000)
    // Only the organization row was read; membership came from the caller.
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
  })

  it('normalizes ISO string dates crossing the hook serialization boundary', async () => {
    const orgId = nextOrgId()
    queueTableRows(organization, [
      { version: 1, sessionPolicySettings: { maxSessionHours: 24, idleTimeoutHours: null } },
    ])

    const result = await clampExpiryForSession(
      {
        userId: 'user-iso',
        createdAt: createdAt.toISOString(),
        expiresAt: proposed.toISOString(),
      },
      orgId
    )

    expect(result?.getTime()).toBe(createdAt.getTime() + 24 * 60 * 60 * 1000)
  })

  it('re-reads the policy when the caller bypasses the cache', async () => {
    const orgId = nextOrgId()
    queueTableRows(organization, [{ version: 1, sessionPolicySettings: null }])
    await clampExpiryForSession({ userId: 'u', createdAt, expiresAt: proposed }, orgId)

    // A policy saved on another process between the two calls: the bypass is
    // what stops a just-tightened policy from being missed at session create.
    queueTableRows(organization, [
      { version: 2, sessionPolicySettings: { maxSessionHours: 24, idleTimeoutHours: null } },
    ])
    const result = await clampExpiryForSession(
      { userId: 'u', createdAt, expiresAt: proposed },
      orgId,
      { bypassPolicyCache: true }
    )

    expect(result?.getTime()).toBe(createdAt.getTime() + 24 * 60 * 60 * 1000)
  })
})
