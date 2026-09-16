/**
 * @vitest-environment node
 */
import type { SessionPrincipal } from '@sim/auth/principal'
import {
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  resetPermissionGroupScopeMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

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
  canUserManageWorkspaceBilling: vi.fn(),
  canUserManageBillingEntity: vi.fn(),
  isCapabilityWithheldForUser: vi.fn(),
}))

vi.mock('@/lib/permission-groups/user-scope.server', () => ({
  isCapabilityWithheldForUser: mocks.isCapabilityWithheldForUser,
}))

vi.mock('@/lib/billing/core/workspace-billing-authority', () => ({
  canUserManageWorkspaceBilling: mocks.canUserManageWorkspaceBilling,
  canUserManageBillingEntity: mocks.canUserManageBillingEntity,
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
import { PersonalApiKeysDisabledError } from '@/lib/core/application'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

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
const oauthPrincipal = {
  kind: 'oauth_access_token' as const,
  userId: 'user-1',
  clientId: 'partner-app',
  tokenId: 'token-1',
  scopes: ['api:read'],
  expiresAt: new Date('2099-01-01T00:00:00Z'),
}

describe('billing application use cases', () => {
  it('rejects an OAuth grant without API access before loading billing or workspace state', async () => {
    vi.clearAllMocks()
    const principal = {
      kind: 'oauth_access_token',
      userId: 'user-1',
      clientId: 'client-1',
      tokenId: 'token-1',
      scopes: ['offline_access'],
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    } as const

    await expect(
      getBillingStatus.execute({ principal, input: { workspaceId: 'workspace-1' } })
    ).rejects.toMatchObject({ requiredScope: 'api:read' })
    expect(mocks.loadWorkspace).not.toHaveBeenCalled()
    expect(mocks.resolveAttribution).not.toHaveBeenCalled()
    expect(mocks.resolveSystemAttribution).not.toHaveBeenCalled()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetPermissionGroupScopeMock()
    mocks.loadWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.canUserManageWorkspaceBilling.mockResolvedValue(false)
    mocks.canUserManageBillingEntity.mockResolvedValue(false)
    mocks.isCapabilityWithheldForUser.mockResolvedValue(false)
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
    expect(result).toMatchObject({ plan: 'free', status: 'active' })
    expect(mocks.resolveSystemAttribution).toHaveBeenCalledWith('workspace-1')
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.resolveAttribution).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  /**
   * A workspace API key is actor-less, and any workspace `admin` may mint one,
   * so granting it the pool would launder the exact role the projection
   * excludes — across the whole organization on an organization-hosted
   * workspace.
   */
  it('withholds the payer pool from an actor-less workspace key', async () => {
    const result = await getBillingStatus.execute({
      principal: workspacePrincipal,
      input: {},
    })

    expect(result.credits).toBeNull()
    expect(result.storage).toBeNull()
    expect(mocks.canUserManageWorkspaceBilling).not.toHaveBeenCalled()
  })

  /**
   * The billing reads resolve their own workspace scope instead of running
   * through `authorizeWorkspaceOperation`, so the funnel's personal-key refusal
   * has to be repeated here — otherwise the same key v2 refuses everywhere else
   * still reads a workspace's plan and ledger.
   */
  it('refuses a personal key whose group withholds personal keys', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disablePersonalApiKeys: true,
    })

    await expect(
      getBillingStatus.execute({
        principal: personalPrincipal,
        input: { workspaceId: 'workspace-1' },
      })
    ).rejects.toBeInstanceOf(PersonalApiKeysDisabledError)
  })

  /**
   * The account-scoped read names no workspace, so the workspace branch's
   * `personal_api_key.use` check never runs on it. Without a gate of its own,
   * the same key an organization withholds from the workspace-scoped read still
   * reads the account's plan, balance and usage by dropping the parameter.
   */
  it('refuses an account-scoped personal key through the organization default group', async () => {
    mocks.isCapabilityWithheldForUser.mockResolvedValue(true)

    await expect(
      getBillingStatus.execute({ principal: personalPrincipal, input: {} })
    ).rejects.toBeInstanceOf(PersonalApiKeysDisabledError)

    expect(mocks.isCapabilityWithheldForUser).toHaveBeenCalledWith('user-1', 'personal_api_key.use')
  })

  it('never applies the account-scoped personal-key gate to a workspace key', async () => {
    mocks.isCapabilityWithheldForUser.mockResolvedValue(true)

    await expect(
      getBillingStatus.execute({ principal: workspacePrincipal, input: {} })
    ).resolves.toBeDefined()
  })

  it.each(['sim-cli', 'partner-app'])(
    'withholds account billing from the %s OAuth token through the default group',
    async (clientId) => {
      mocks.isCapabilityWithheldForUser.mockImplementation(
        async (_userId: string, capability: string) => capability === 'oauth_apps.use'
      )
      await expect(
        getBillingStatus.execute({ principal: { ...oauthPrincipal, clientId }, input: {} })
      ).rejects.toMatchObject({ capability: 'oauth_apps.use' })
      expect(mocks.isCapabilityWithheldForUser).toHaveBeenCalledWith('user-1', 'oauth_apps.use')
      expect(mocks.getSubscription).not.toHaveBeenCalled()
      expect(mocks.getUsageLogs).not.toHaveBeenCalled()
    }
  )

  it('rechecks an existing OAuth token against the billing workspace group', async () => {
    await expect(
      getBillingStatus.execute({ principal: oauthPrincipal, input: { workspaceId: 'workspace-1' } })
    ).resolves.toBeDefined()
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disableOAuthAppAccess: true,
    })
    mocks.resolveAttribution.mockClear()
    await expect(
      getBillingStatus.execute({ principal: oauthPrincipal, input: { workspaceId: 'workspace-1' } })
    ).rejects.toMatchObject({ capability: 'oauth_apps.use' })
    expect(mocks.resolveAttribution).not.toHaveBeenCalled()
  })

  it('preserves API-key billing when only OAuth app access is withheld', async () => {
    mocks.isCapabilityWithheldForUser.mockImplementation(
      async (_userId: string, capability: string) => capability === 'oauth_apps.use'
    )
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disableOAuthAppAccess: true,
    })
    await expect(
      getBillingStatus.execute({
        principal: personalPrincipal,
        input: { workspaceId: 'workspace-1' },
      })
    ).resolves.toBeDefined()
    await expect(
      getBillingStatus.execute({ principal: workspacePrincipal, input: {} })
    ).resolves.toBeDefined()
  })

  it('never reads the payer storage pool it may not disclose', async () => {
    await getBillingStatus.execute({ principal: workspacePrincipal, input: {} })
    await getBillingStatus.execute({
      principal: personalPrincipal,
      input: { workspaceId: 'workspace-1' },
    })

    expect(mocks.resolveStorageContext).not.toHaveBeenCalled()
    expect(mocks.getStorageUsageForContext).not.toHaveBeenCalled()
  })

  it('still reports a workspace key an exceeded pooled limit it cannot read', async () => {
    mocks.checkAttributedBlocks.mockResolvedValue({ blocked: true })

    const result = await getBillingStatus.execute({
      principal: workspacePrincipal,
      input: {},
    })

    expect(result.status).toBe('billing_blocked')
    expect(result.credits).toBeNull()
  })

  it('withholds the payer pool from a workspace member who cannot manage billing', async () => {
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.canUserManageWorkspaceBilling.mockResolvedValue(false)

    const result = await getBillingStatus.execute({
      principal: personalPrincipal,
      input: { workspaceId: 'workspace-1' },
    })

    expect(result.credits).toBeNull()
    expect(result.storage).toBeNull()
    expect(result).toMatchObject({ workspaceId: 'workspace-1', plan: 'free', status: 'active' })
    expect(mocks.canUserManageWorkspaceBilling).toHaveBeenCalledWith(workspaceContext, 'user-1')
  })

  it('withholds the payer pool from a workspace admin who cannot manage billing', async () => {
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.canUserManageWorkspaceBilling.mockResolvedValue(false)

    const result = await getBillingStatus.execute({
      principal: personalPrincipal,
      input: { workspaceId: 'workspace-1' },
    })

    expect(result.credits).toBeNull()
    expect(result.storage).toBeNull()
  })

  it('still reports an exceeded payer limit without disclosing the pool', async () => {
    mocks.canUserManageWorkspaceBilling.mockResolvedValue(false)
    mocks.checkUsageStatus.mockResolvedValue({ currentUsage: 40, limit: 10, isExceeded: true })

    const result = await getBillingStatus.execute({
      principal: personalPrincipal,
      input: { workspaceId: 'workspace-1' },
    })

    expect(result.status).toBe('limit_exceeded')
    expect(result.credits).toBeNull()
  })

  it('projects the payer pool to a member who can manage billing', async () => {
    mocks.canUserManageWorkspaceBilling.mockResolvedValue(true)

    const result = await getBillingStatus.execute({
      principal: personalPrincipal,
      input: { workspaceId: 'workspace-1' },
    })

    expect(result.credits).toEqual({ used: 200, limit: 2_000, remaining: 1_800 })
    expect(result.storage).toEqual({
      usedBytes: 5_242_880,
      limitBytes: 1_073_741_824,
      percentUsed: 0.48828125,
    })
  })

  it('always reports the account-scoped pool the caller owns', async () => {
    mocks.canUserManageWorkspaceBilling.mockResolvedValue(false)
    mocks.getSubscription.mockResolvedValue({ plan: 'pro' })
    mocks.deriveBillingContext.mockReturnValue({
      billingEntity: { type: 'user', id: 'user-1' },
      billingPeriod: {
        start: new Date('2026-01-01T00:00:00Z'),
        end: new Date('2026-02-01T00:00:00Z'),
      },
    })
    mocks.checkBillingBlocked.mockResolvedValue({ blocked: false })

    const result = await getBillingStatus.execute({ principal: personalPrincipal, input: {} })

    expect(result.credits).toEqual({ used: 200, limit: 2_000, remaining: 1_800 })
    expect(result.storage).not.toBeNull()
  })

  /**
   * `getHighestPrioritySubscription` resolves an organization subscription from
   * any `member` row regardless of role, so dropping `workspaceId` must not
   * hand a plain member the organization-wide pool the workspace branch
   * withholds.
   */
  it('withholds the organization pool from an account caller who cannot manage it', async () => {
    mocks.getSubscription.mockResolvedValue({ plan: 'team', referenceId: 'organization-1' })
    mocks.deriveBillingContext.mockReturnValue({
      billingEntity: { type: 'organization', id: 'organization-1' },
      billingPeriod: {
        start: new Date('2026-01-01T00:00:00Z'),
        end: new Date('2026-02-01T00:00:00Z'),
      },
    })
    mocks.canUserManageBillingEntity.mockResolvedValue(false)
    mocks.checkBillingBlocked.mockResolvedValue({ blocked: false })
    mocks.checkBillingEntityBlocked.mockResolvedValue({ blocked: false })

    const result = await getBillingStatus.execute({ principal: personalPrincipal, input: {} })

    expect(result.credits).toBeNull()
    expect(result.storage).toBeNull()
    expect(result).toMatchObject({ workspaceId: null, plan: 'team', status: 'active' })
    expect(mocks.canUserManageBillingEntity).toHaveBeenCalledWith(
      { type: 'organization', id: 'organization-1' },
      'user-1'
    )
    expect(mocks.getUserStorageUsage).not.toHaveBeenCalled()
    expect(mocks.getUserStorageLimit).not.toHaveBeenCalled()
  })

  it('still reports an exceeded organization limit to an account caller who cannot read it', async () => {
    mocks.getSubscription.mockResolvedValue({ plan: 'team', referenceId: 'organization-1' })
    mocks.deriveBillingContext.mockReturnValue({
      billingEntity: { type: 'organization', id: 'organization-1' },
      billingPeriod: {
        start: new Date('2026-01-01T00:00:00Z'),
        end: new Date('2026-02-01T00:00:00Z'),
      },
    })
    mocks.canUserManageBillingEntity.mockResolvedValue(false)
    mocks.checkBillingBlocked.mockResolvedValue({ blocked: false })
    mocks.checkBillingEntityBlocked.mockResolvedValue({ blocked: false })
    mocks.checkUsageStatus.mockResolvedValue({ currentUsage: 40, limit: 10, isExceeded: true })

    const result = await getBillingStatus.execute({ principal: personalPrincipal, input: {} })

    expect(result.status).toBe('limit_exceeded')
    expect(result.credits).toBeNull()
  })

  it('projects the organization pool to an account caller who administers it', async () => {
    mocks.getSubscription.mockResolvedValue({ plan: 'team', referenceId: 'organization-1' })
    mocks.deriveBillingContext.mockReturnValue({
      billingEntity: { type: 'organization', id: 'organization-1' },
      billingPeriod: {
        start: new Date('2026-01-01T00:00:00Z'),
        end: new Date('2026-02-01T00:00:00Z'),
      },
    })
    mocks.canUserManageBillingEntity.mockResolvedValue(true)
    mocks.checkBillingBlocked.mockResolvedValue({ blocked: false })
    mocks.checkBillingEntityBlocked.mockResolvedValue({ blocked: false })

    const result = await getBillingStatus.execute({ principal: personalPrincipal, input: {} })

    expect(result.credits).toEqual({ used: 200, limit: 2_000, remaining: 1_800 })
    expect(result.storage).toEqual({
      usedBytes: 5_242_880,
      limitBytes: 1_073_741_824,
      percentUsed: 0.48828125,
    })
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
    const result = await listBillingLogs.execute({
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
    expect(result.scope).toBe('workspace')
  })

  /**
   * A personal key reports the person holding it, so naming a workspace narrows
   * that person's own events rather than opening the whole workspace ledger. The
   * ledger carries Wand, Chat, voice, enrichment, and knowledge-base spend that
   * no other surface publishes at the workspace `read` role, so widening this to
   * the resolved scope would be a privilege expansion, not a fix. The reported
   * `scope` is what tells the caller which of the two sets it received.
   */
  it('keeps personal-key billing logs actor-scoped and workspace-filtered', async () => {
    const result = await listBillingLogs.execute({
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
    expect(result.scope).toBe('user')
  })

  it('keeps an unscoped personal-key ledger to the calling account', async () => {
    const result = await listBillingLogs.execute({
      principal: personalPrincipal,
      input: {
        startDate: new Date('2026-01-01T00:00:00Z'),
        endDate: new Date('2026-02-01T00:00:00Z'),
        limit: 50,
      },
    })

    expect(mocks.getUsageLogs).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ includeSummary: false, limit: 50 })
    )
    expect(mocks.getWorkspaceUsageLogs).not.toHaveBeenCalled()
    expect(mocks.loadWorkspace).not.toHaveBeenCalled()
    expect(result.scope).toBe('user')
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
