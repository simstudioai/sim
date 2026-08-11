/**
 * @vitest-environment node
 */
import type { SessionPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  resolveSystemAttribution: vi.fn(),
  resolveAttribution: vi.fn(),
  checkUsageStatus: vi.fn(),
  checkAttributedBlocks: vi.fn(),
  toUsageLimitSubscription: vi.fn(),
  getSubscription: vi.fn(),
  deriveBillingContext: vi.fn(),
  checkBillingBlocked: vi.fn(),
  checkBillingEntityBlocked: vi.fn(),
  resolveStorageContext: vi.fn(),
  getStorageLimitForContext: vi.fn(),
  getStorageUsageForContext: vi.fn(),
  getUserStorageLimit: vi.fn(),
  getUserStorageUsage: vi.fn(),
  getUsageLogs: vi.fn(),
  getWorkspaceUsageLogs: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === 'write' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveSystemBillingAttribution: mocks.resolveSystemAttribution,
  resolveBillingAttribution: mocks.resolveAttribution,
  checkAttributedBillingBlocks: mocks.checkAttributedBlocks,
  toUsageLimitSubscription: mocks.toUsageLimitSubscription,
}))

vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkUsageStatus: mocks.checkUsageStatus,
  checkBillingBlocked: mocks.checkBillingBlocked,
  checkBillingEntityBlocked: mocks.checkBillingEntityBlocked,
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: mocks.getSubscription,
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  deriveBillingContext: mocks.deriveBillingContext,
  getUserUsageLogs: mocks.getUsageLogs,
  getWorkspaceUsageLogs: mocks.getWorkspaceUsageLogs,
}))

vi.mock('@/lib/billing/storage', () => ({
  resolveStorageBillingContext: mocks.resolveStorageContext,
  getStorageLimitForBillingContext: mocks.getStorageLimitForContext,
  getStorageUsageForBillingContext: mocks.getStorageUsageForContext,
  getUserStorageLimit: mocks.getUserStorageLimit,
  getUserStorageUsage: mocks.getUserStorageUsage,
}))

vi.mock('@sim/audit', () => ({ recordAudit: mocks.recordAudit }))

import { getBillingStatus } from '@/lib/billing/application/get-billing-status'
import { listBillingLogs } from '@/lib/billing/application/list-billing-logs'

const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const personalPrincipal = {
  kind: 'personal_api_key' as const,
  userId: 'user-1',
  keyId: 'personal-key-1',
}
const workspacePrincipal = {
  kind: 'workspace_api_key' as const,
  workspaceId: 'workspace-1',
  keyId: 'workspace-key-1',
}

describe('billing application use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.checkUsageStatus.mockResolvedValue({ currentUsage: 1, limit: 10, isExceeded: false })
    mocks.checkAttributedBlocks.mockResolvedValue({ blocked: false })
    mocks.toUsageLimitSubscription.mockReturnValue(null)
    mocks.resolveSystemAttribution.mockResolvedValue({
      billedAccountUserId: 'billing-owner-1',
      billingPeriod: { start: '2026-01-01', end: '2026-02-01' },
      payerSubscription: null,
    })
    mocks.resolveAttribution.mockResolvedValue({
      billedAccountUserId: 'billing-owner-1',
      billingPeriod: { start: '2026-01-01', end: '2026-02-01' },
      payerSubscription: null,
    })
    mocks.resolveStorageContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      billedAccountUserId: 'billing-owner-1',
      billingEntity: { type: 'user', id: 'billing-owner-1' },
      plan: null,
      customStorageLimitGB: null,
    })
    mocks.getStorageLimitForContext.mockReturnValue(1_073_741_824)
    mocks.getStorageUsageForContext.mockResolvedValue(5_242_880)
    mocks.getUserStorageLimit.mockResolvedValue(1_073_741_824)
    mocks.getUserStorageUsage.mockResolvedValue(5_242_880)
    mocks.getUsageLogs.mockResolvedValue({
      logs: [],
      summary: { totalCost: 0, bySource: {} },
      pagination: { hasMore: false },
    })
    mocks.getWorkspaceUsageLogs.mockResolvedValue({
      logs: [],
      summary: { totalCost: 0, bySource: {} },
      pagination: { hasMore: false },
    })
  })

  it('rejects unsupported principals before protected loading', async () => {
    const session: SessionPrincipal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' }

    await expect(getBillingStatus.execute({ principal: session, input: {} })).rejects.toMatchObject(
      {
        code: 'forbidden',
      }
    )
    expect(mocks.loadWorkspace).not.toHaveBeenCalled()
    expect(mocks.getSubscription).not.toHaveBeenCalled()
  })

  it('pins workspace keys before loading a different workspace', async () => {
    await expect(
      getBillingStatus.execute({
        principal: workspacePrincipal,
        input: { workspaceId: 'workspace-2' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.loadWorkspace).not.toHaveBeenCalled()
    expect(mocks.resolveSystemAttribution).not.toHaveBeenCalled()
  })

  it('uses system billing attribution for workspace-key status without human authorization', async () => {
    const result = await getBillingStatus.execute({
      principal: workspacePrincipal,
      input: {},
    })

    expect(result.workspaceId).toBe('workspace-1')
    expect(result.storage).toEqual({
      usedBytes: 5_242_880,
      limitBytes: 1_073_741_824,
      percentUsed: 0.48828125,
    })
    expect(mocks.resolveSystemAttribution).toHaveBeenCalledWith('workspace-1')
    expect(mocks.resolveStorageContext).toHaveBeenCalledWith('workspace-1')
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.resolveAttribution).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('uses the personal principal as account authority', async () => {
    mocks.getSubscription.mockResolvedValue({ plan: 'pro' })
    mocks.deriveBillingContext.mockReturnValue({
      billingEntity: { type: 'user', id: 'user-1' },
      billingPeriod: {
        start: new Date('2026-01-01T00:00:00Z'),
        end: new Date('2026-02-01T00:00:00Z'),
      },
    })
    mocks.checkBillingBlocked.mockResolvedValue({ blocked: false })

    await getBillingStatus.execute({ principal: personalPrincipal, input: {} })

    expect(mocks.getSubscription).toHaveBeenCalledWith('user-1')
    expect(mocks.loadWorkspace).not.toHaveBeenCalled()
  })

  it('lists the complete workspace ledger for a workspace key', async () => {
    await listBillingLogs.execute({
      principal: workspacePrincipal,
      input: {
        startDate: new Date('2026-01-01T00:00:00Z'),
        endDate: new Date('2026-02-01T00:00:00Z'),
        limit: 50,
      },
    })

    expect(mocks.getWorkspaceUsageLogs).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({ includeSummary: false, limit: 50 })
    )
    expect(mocks.getUsageLogs).not.toHaveBeenCalled()
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('keeps personal-key billing logs actor-scoped and workspace-filtered', async () => {
    await listBillingLogs.execute({
      principal: personalPrincipal,
      input: {
        workspaceId: 'workspace-1',
        startDate: new Date('2026-01-01T00:00:00Z'),
        endDate: new Date('2026-02-01T00:00:00Z'),
        limit: 50,
      },
    })

    expect(mocks.getUsageLogs).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ workspaceId: 'workspace-1', includeSummary: false, limit: 50 })
    )
    expect(mocks.getWorkspaceUsageLogs).not.toHaveBeenCalled()
  })

  it('apportions credits only across the bounded page', async () => {
    mocks.getWorkspaceUsageLogs.mockResolvedValueOnce({
      logs: [
        { id: 'log-1', cost: 0.003 },
        { id: 'log-2', cost: 0.003 },
      ],
      summary: { totalCost: 0, bySource: {} },
      pagination: { hasMore: true, nextCursor: 'log-2' },
    })

    const result = await listBillingLogs.execute({
      principal: workspacePrincipal,
      input: {
        startDate: new Date('2026-01-01T00:00:00Z'),
        endDate: new Date('2026-02-01T00:00:00Z'),
        limit: 2,
      },
    })

    expect(result.creditsByLogId).toEqual({ 'log-1': 1, 'log-2': 0 })
  })

  it('propagates workspace-store failures', async () => {
    const failure = new Error('database unavailable')
    mocks.loadWorkspace.mockRejectedValueOnce(failure)

    await expect(
      getBillingStatus.execute({
        principal: personalPrincipal,
        input: { workspaceId: 'workspace-1' },
      })
    ).rejects.toBe(failure)
  })
})
