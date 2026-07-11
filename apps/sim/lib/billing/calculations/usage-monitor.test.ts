/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFlags,
  mockDbLimit,
  mockGetOrgMemberUsageForBillingPeriod,
  mockGetOrgMemberUsageLimit,
  mockGetOrgMemberWorkspaceUsage,
  mockIsOrganizationBillingBlocked,
} = vi.hoisted(() => ({
  mockFlags: { isHosted: true, isBillingEnabled: true },
  mockDbLimit: vi.fn(),
  mockGetOrgMemberUsageForBillingPeriod: vi.fn(),
  mockGetOrgMemberUsageLimit: vi.fn(),
  mockGetOrgMemberWorkspaceUsage: vi.fn(),
  mockIsOrganizationBillingBlocked: vi.fn(),
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  get isHosted() {
    return mockFlags.isHosted
  },
  get isBillingEnabled() {
    return mockFlags.isBillingEnabled
  },
}))

vi.mock('@sim/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mockDbLimit,
        }),
      }),
    }),
  },
}))

vi.mock('@/lib/billing/organizations/member-limits', () => ({
  getOrgMemberUsageForBillingPeriod: mockGetOrgMemberUsageForBillingPeriod,
  getOrgMemberUsageLimit: mockGetOrgMemberUsageLimit,
  getOrgMemberWorkspaceUsage: mockGetOrgMemberWorkspaceUsage,
}))

vi.mock('@/lib/billing/core/access', () => ({
  isOrganizationBillingBlocked: mockIsOrganizationBillingBlocked,
}))

// core/usage pulls in the email-rendering chain at import; stub the two symbols
// usage-monitor imports from it so the module loads in a node test env.
vi.mock('@/lib/billing/core/usage', () => ({
  getPooledOrgCurrentPeriodCost: vi.fn(),
  getUserUsageLimit: vi.fn(),
}))

import {
  checkBillingBlocked,
  checkBillingEntityBlocked,
  checkOrganizationMemberUsageLimit,
  checkOrgMemberUsageLimit,
} from '@/lib/billing/calculations/usage-monitor'

describe('checkBillingBlocked', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlags.isHosted = true
    mockFlags.isBillingEnabled = true
    mockDbLimit.mockResolvedValue([{ blocked: false, blockedReason: null }])
  })

  it("checks only the actor's own user account without inspecting organization memberships", async () => {
    mockIsOrganizationBillingBlocked.mockResolvedValue(true)

    await expect(checkBillingBlocked('actor-1')).resolves.toEqual({ blocked: false })

    expect(mockDbLimit).toHaveBeenCalledTimes(1)
    expect(mockIsOrganizationBillingBlocked).not.toHaveBeenCalled()
  })
})

describe('checkBillingEntityBlocked', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlags.isHosted = true
    mockFlags.isBillingEnabled = true
    mockIsOrganizationBillingBlocked.mockResolvedValue(false)
    mockDbLimit.mockResolvedValue([])
  })

  it('checks only the exact organization payer', async () => {
    mockIsOrganizationBillingBlocked.mockResolvedValue(true)

    await expect(
      checkBillingEntityBlocked({ type: 'organization', id: 'workspace-org' })
    ).resolves.toMatchObject({ blocked: true })

    expect(mockIsOrganizationBillingBlocked).toHaveBeenCalledWith('workspace-org')
    expect(mockDbLimit).not.toHaveBeenCalled()
  })

  it('checks the exact personal payer directly', async () => {
    mockDbLimit.mockResolvedValue([{ blocked: true, blockedReason: 'dispute' }])

    await expect(
      checkBillingEntityBlocked({ type: 'user', id: 'personal-payer' })
    ).resolves.toEqual({
      blocked: true,
      message: 'Account frozen. Please contact support to resolve this issue.',
    })

    expect(mockIsOrganizationBillingBlocked).not.toHaveBeenCalled()
  })
})

describe('checkOrganizationMemberUsageLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlags.isHosted = true
    mockFlags.isBillingEnabled = true
    mockGetOrgMemberUsageLimit.mockResolvedValue(2)
    mockGetOrgMemberUsageForBillingPeriod.mockResolvedValue(1)
  })

  it('uses the immutable organization and billing period', async () => {
    const billingPeriod = {
      start: new Date('2026-06-01T00:00:00.000Z'),
      end: new Date('2026-07-01T00:00:00.000Z'),
    }

    await expect(
      checkOrganizationMemberUsageLimit('actor-1', 'snapshot-org', billingPeriod)
    ).resolves.toMatchObject({
      currentUsage: 1,
      isExceeded: false,
      limit: 2,
    })

    expect(mockGetOrgMemberUsageForBillingPeriod).toHaveBeenCalledWith(
      'snapshot-org',
      'actor-1',
      billingPeriod
    )
    expect(mockGetOrgMemberWorkspaceUsage).not.toHaveBeenCalled()
  })
})

describe('checkOrgMemberUsageLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlags.isHosted = true
    mockFlags.isBillingEnabled = true
    mockDbLimit.mockResolvedValue([{ organizationId: 'org-1' }])
    mockGetOrgMemberUsageLimit.mockResolvedValue(2)
    mockGetOrgMemberWorkspaceUsage.mockResolvedValue(1)
  })

  it('no-ops when not hosted', async () => {
    mockFlags.isHosted = false
    const result = await checkOrgMemberUsageLimit('user-1', 'ws-1')
    expect(result.isExceeded).toBe(false)
    expect(mockDbLimit).not.toHaveBeenCalled()
    expect(mockGetOrgMemberUsageLimit).not.toHaveBeenCalled()
  })

  it('no-ops when billing is disabled', async () => {
    mockFlags.isBillingEnabled = false
    const result = await checkOrgMemberUsageLimit('user-1', 'ws-1')
    expect(result.isExceeded).toBe(false)
  })

  it('no-ops when workspaceId is empty', async () => {
    const result = await checkOrgMemberUsageLimit('user-1', '')
    expect(result.isExceeded).toBe(false)
    expect(mockDbLimit).not.toHaveBeenCalled()
  })

  it('no-ops when the workspace is not org-owned', async () => {
    mockDbLimit.mockResolvedValue([{ organizationId: null }])
    const result = await checkOrgMemberUsageLimit('user-1', 'ws-1')
    expect(result.isExceeded).toBe(false)
    expect(mockGetOrgMemberUsageLimit).not.toHaveBeenCalled()
  })

  it('no-ops when the member has no cap set', async () => {
    mockGetOrgMemberUsageLimit.mockResolvedValue(null)
    const result = await checkOrgMemberUsageLimit('user-1', 'ws-1')
    expect(result.isExceeded).toBe(false)
    expect(mockGetOrgMemberWorkspaceUsage).not.toHaveBeenCalled()
  })

  it('does not block when usage is below the cap', async () => {
    mockGetOrgMemberWorkspaceUsage.mockResolvedValue(1)
    mockGetOrgMemberUsageLimit.mockResolvedValue(2)
    const result = await checkOrgMemberUsageLimit('user-1', 'ws-1')
    expect(result.isExceeded).toBe(false)
    expect(result.currentUsage).toBe(1)
    expect(result.limit).toBe(2)
    expect(result.message).toBeUndefined()
  })

  it('blocks when usage meets the cap (>=)', async () => {
    mockGetOrgMemberWorkspaceUsage.mockResolvedValue(2)
    mockGetOrgMemberUsageLimit.mockResolvedValue(2)
    const result = await checkOrgMemberUsageLimit('user-1', 'ws-1')
    expect(result.isExceeded).toBe(true)
    expect(result.message).toBeTruthy()
  })

  it('blocks all usage when the cap is 0', async () => {
    mockGetOrgMemberUsageLimit.mockResolvedValue(0)
    mockGetOrgMemberWorkspaceUsage.mockResolvedValue(0)
    const result = await checkOrgMemberUsageLimit('user-1', 'ws-1')
    expect(result.isExceeded).toBe(true)
  })

  it('fails open when an unexpected error occurs', async () => {
    mockDbLimit.mockRejectedValue(new Error('db down'))
    const result = await checkOrgMemberUsageLimit('user-1', 'ws-1')
    expect(result.isExceeded).toBe(false)
  })

  it('fails open when org-workspace usage cannot be computed (unexpected error)', async () => {
    mockGetOrgMemberWorkspaceUsage.mockRejectedValue(new Error('db unavailable'))
    const result = await checkOrgMemberUsageLimit('user-1', 'ws-1')
    expect(result.isExceeded).toBe(false)
  })
})
