/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFlags, mockDbLimit, mockGetOrgMemberUsageLimit, mockGetOrgMemberWorkspaceUsage } =
  vi.hoisted(() => ({
    mockFlags: { isHosted: true, isBillingEnabled: true },
    mockDbLimit: vi.fn(),
    mockGetOrgMemberUsageLimit: vi.fn(),
    mockGetOrgMemberWorkspaceUsage: vi.fn(),
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
  getOrgMemberUsageLimit: mockGetOrgMemberUsageLimit,
  getOrgMemberWorkspaceUsage: mockGetOrgMemberWorkspaceUsage,
}))

// core/usage pulls in the email-rendering chain at import; stub the two symbols
// usage-monitor imports from it so the module loads in a node test env.
vi.mock('@/lib/billing/core/usage', () => ({
  getPooledOrgCurrentPeriodCost: vi.fn(),
  getUserUsageLimit: vi.fn(),
}))

import { checkOrgMemberUsageLimit } from '@/lib/billing/calculations/usage-monitor'

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
