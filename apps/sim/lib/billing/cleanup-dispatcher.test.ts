import { asyncJobsMock, asyncJobsMockFns } from '@sim/testing/mocks/async-jobs.mock'
import { asyncJobsRegionMock } from '@sim/testing/mocks/async-jobs-region.mock'
import { billingCoreMock, billingCoreMockFns } from '@sim/testing/mocks/billing-core.mock'
import { billingSubscriptionMock } from '@sim/testing/mocks/billing-subscription.mock'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { schemaMock } from '@sim/testing/mocks/schema.mock'
import {
  triggerAvailabilityMock,
  triggerAvailabilityMockFns,
} from '@sim/testing/mocks/trigger-availability.mock'
import { workspacesPolicyMock } from '@sim/testing/mocks/workspaces-policy.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/core/billing', () => billingCoreMock)
vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)
vi.mock('@/lib/core/async-jobs', () => asyncJobsMock)
vi.mock('@/lib/core/async-jobs/config', () => ({ shouldExecuteInline: vi.fn(() => false) }))
vi.mock('@/lib/core/async-jobs/region', () => asyncJobsRegionMock)
vi.mock('@/lib/core/config/trigger-availability', () => triggerAvailabilityMock)
vi.mock('@/lib/workspaces/policy', () => workspacesPolicyMock)

import { dispatchCleanupJobs, runCleanupWithLimits } from '@/lib/billing/cleanup-dispatcher'
import { getHighestPriorityPersonalSubscription } from '@/lib/billing/core/subscription'
import { isOrganizationWorkspace } from '@/lib/workspaces/policy'

const mockIsTriggerAvailable = triggerAvailabilityMockFns.mockIsTriggerAvailable
const mockGetOrganizationSubscription = billingCoreMockFns.mockGetOrganizationSubscription
const mockEnqueue = asyncJobsMockFns.mockJobQueue.enqueue

afterAll(resetEnvFlagsMock)

describe('dispatchCleanupJobs retention gate', () => {
  beforeEach(() => {
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

describe('organization-owned Search retention dispatch', () => {
  beforeEach(() => {
    resetDbChainMock()
    setEnvFlags({ isBillingEnabled: false, isDataRetentionEnabled: true })
    mockIsTriggerAvailable.mockReturnValue(false)
    mockGetOrganizationSubscription.mockResolvedValue(null)
    mockEnqueue.mockResolvedValue('cleanup-job')
    queueTableRows(schemaMock.workspace, [])
  })

  it('dispatches an organization with zero workspaces using its own configured window', async () => {
    queueTableRows(schemaMock.organization, [
      {
        id: 'org-1',
        settings: {
          softDeleteRetentionHours: 72,
          retentionOverrides: [{ workspaceId: 'irrelevant', softDeleteRetentionHours: 1 }],
        },
      },
    ])
    queueTableRows(schemaMock.organization, [])
    const result = await dispatchCleanupJobs('cleanup-soft-deletes')
    expect(result).toMatchObject({ workspaceCount: 0, chunkCount: 1 })
    expect(mockEnqueue).toHaveBeenCalledWith(
      'cleanup-soft-deletes',
      {
        plan: 'enterprise',
        workspaceIds: [],
        organizationIds: ['org-1'],
        retentionHours: 72,
        label: 'enterprise/organization/org-1',
      },
      expect.any(Object)
    )
    expect(mockGetOrganizationSubscription).not.toHaveBeenCalled()
  })

  it('does not infer a personal payer when the organization has no subscription', async () => {
    setEnvFlags({ isBillingEnabled: true })
    queueTableRows(schemaMock.organization, [
      { id: 'org-1', settings: { softDeleteRetentionHours: 24 } },
    ])
    queueTableRows(schemaMock.organization, [])
    await dispatchCleanupJobs('cleanup-soft-deletes')
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('fails closed after an organization plan lookup error', async () => {
    setEnvFlags({ isBillingEnabled: true })
    mockGetOrganizationSubscription.mockRejectedValue(new Error('subscription unavailable'))
    queueTableRows(schemaMock.organization, [
      { id: 'org-1', settings: { softDeleteRetentionHours: 24 } },
    ])
    queueTableRows(schemaMock.organization, [])
    await dispatchCleanupJobs('cleanup-soft-deletes')
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('dispatches configured organization chat retention independently of soft deletes', async () => {
    queueTableRows(schemaMock.organization, [
      { id: 'org-1', settings: { taskCleanupHours: 48, softDeleteRetentionHours: 72 } },
    ])
    queueTableRows(schemaMock.organization, [])
    await dispatchCleanupJobs('cleanup-tasks')
    expect(mockEnqueue).toHaveBeenCalledWith(
      'cleanup-tasks',
      expect.objectContaining({
        workspaceIds: [],
        organizationIds: ['org-1'],
        retentionHours: 48,
      }),
      expect.any(Object)
    )
  })
})

describe('cleanup limits', () => {
  beforeEach(() => {
    resetDbChainMock()
    setEnvFlags({ isBillingEnabled: false, isDataRetentionEnabled: true })
    mockIsTriggerAvailable.mockReturnValue(true)
    vi.mocked(getHighestPriorityPersonalSubscription).mockReset()
    mockGetOrganizationSubscription.mockReset()
    vi.mocked(isOrganizationWorkspace).mockReset()
  })

  it('shares budgets across owners and stops before the next page', async () => {
    queueTableRows(
      schemaMock.workspace,
      ['a', 'b', 'c'].map((id) => ({
        id,
        billedAccountUserId: 'user',
        organizationId: null,
        workspaceMode: 'personal',
        organizationSettings: { logRetentionHours: 24 },
      }))
    )
    const seen: number[] = []
    await runCleanupWithLimits('cleanup-logs', { workflowLogs: 2 }, async (_scope, budgets) => {
      seen.push(budgets.workflowLogs.remaining)
      expect(budgets.jobLogs.remaining).toBe(0)
      budgets.workflowLogs.remaining--
    })
    expect(seen).toEqual([2, 1])
    expect(dbChainMockFns.select).toHaveBeenCalledOnce()
  })

  it.each(['personal', 'organization-workspace', 'organization'] as const)(
    'fails a manual job when %s subscription lookup fails',
    async (kind) => {
      setEnvFlags({ isBillingEnabled: true })
      const error = new Error('subscription lookup unavailable')
      vi.mocked(getHighestPriorityPersonalSubscription).mockRejectedValueOnce(error)
      mockGetOrganizationSubscription.mockRejectedValueOnce(error)
      vi.mocked(isOrganizationWorkspace).mockReturnValue(true)
      queueTableRows(
        schemaMock.workspace,
        kind === 'organization'
          ? []
          : [
              {
                id: 'workspace',
                billedAccountUserId: 'user',
                organizationId: 'organization',
                workspaceMode: kind === 'personal' ? 'personal' : 'organization',
                organizationSettings: null,
              },
            ]
      )
      if (kind === 'organization')
        queueTableRows(schemaMock.organization, [{ id: 'organization', settings: null }])
      const runScope = vi.fn()
      await expect(
        runCleanupWithLimits('cleanup-soft-deletes', { files: 1 }, runScope)
      ).rejects.toBe(error)
      expect(runScope).not.toHaveBeenCalled()
    }
  )
})
