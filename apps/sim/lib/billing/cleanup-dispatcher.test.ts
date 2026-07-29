/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  schemaMock,
  setEnvFlags,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsTriggerAvailable, mockGetOrganizationSubscription, mockEnqueue } = vi.hoisted(() => ({
  mockIsTriggerAvailable: vi.fn(),
  mockGetOrganizationSubscription: vi.fn(),
  mockEnqueue: vi.fn(),
}))

vi.mock('@/lib/billing/core/billing', () => ({
  getOrganizationSubscription: mockGetOrganizationSubscription,
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPriorityPersonalSubscription: vi.fn(),
}))
vi.mock('@/lib/cleanup/batch-delete', () => ({
  chunkArray: vi.fn((items: unknown[]) => (items.length > 0 ? [items] : [])),
}))
vi.mock('@/lib/core/async-jobs', () => ({
  getJobQueue: vi.fn(() => ({ enqueue: mockEnqueue })),
}))
vi.mock('@/lib/core/async-jobs/config', () => ({ shouldExecuteInline: vi.fn(() => false) }))
vi.mock('@/lib/core/async-jobs/region', () => ({ resolveTriggerRegion: vi.fn() }))
vi.mock('@/lib/knowledge/documents/service', () => ({
  isTriggerAvailable: mockIsTriggerAvailable,
}))
vi.mock('@/lib/workspaces/policy', () => ({
  WORKSPACE_MODE: { PERSONAL: 'personal', ORGANIZATION: 'organization' },
  isOrganizationWorkspace: vi.fn(),
}))

import { dispatchCleanupJobs } from '@/lib/billing/cleanup-dispatcher'

afterAll(resetEnvFlagsMock)

describe('dispatchCleanupJobs retention gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnvFlags({ isBillingEnabled: false, isDataRetentionEnabled: false })
    mockIsTriggerAvailable.mockReturnValue(false)
    mockGetOrganizationSubscription.mockResolvedValue(null)
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('never dispatches retention deletion when billing is disabled and retention is off', async () => {
    const result = await dispatchCleanupJobs('cleanup-logs')

    expect(result).toEqual({ jobIds: [], jobCount: 0, chunkCount: 0, workspaceCount: 0 })
    expect(mockIsTriggerAvailable).not.toHaveBeenCalled()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('scans workspaces once retention is explicitly enabled', async () => {
    setEnvFlags({ isDataRetentionEnabled: true })
    queueTableRows(schemaMock.workspace, [])

    await dispatchCleanupJobs('cleanup-logs')

    expect(dbChainMockFns.select).toHaveBeenCalled()
  })

  it('deletes nothing for a workspace with no configured retention', async () => {
    setEnvFlags({ isDataRetentionEnabled: true })
    /**
     * The safety property for self-hosted retention: with billing off every
     * workspace resolves as enterprise, which carries no plan default, so a
     * workspace whose organization configured nothing keeps its data forever.
     * Falling through to the free-tier default would silently expire logs on a
     * 30-day window the operator never chose.
     */
    queueTableRows(schemaMock.workspace, [
      {
        id: 'ws-1',
        billedAccountUserId: 'user-1',
        organizationId: null,
        workspaceMode: 'personal',
        organizationSettings: null,
      },
    ])
    queueTableRows(schemaMock.workspace, [])

    const result = await dispatchCleanupJobs('cleanup-logs')

    expect(result.workspaceCount).toBe(0)
    expect(mockGetOrganizationSubscription).not.toHaveBeenCalled()
    /**
     * No chunks at all, including the plan-wide housekeeping one. That chunk is
     * keyed to the hosted free-tier 30-day window, so emitting it off-hosted
     * would act on the very default the per-workspace pass refuses to apply.
     */
    expect(result.chunkCount).toBe(0)
  })
})
