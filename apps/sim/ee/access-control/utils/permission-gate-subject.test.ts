/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUserPermissionConfig: vi.fn(),
}))

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfig: mocks.getUserPermissionConfig,
  getUserPermissionConfigForOrganization: vi.fn(),
  mergeEnvAllowlist: (config: unknown) => config,
  resolveVerifiedUserAccessControlContext: vi.fn(),
  resolveWorkspaceGroup: vi.fn(),
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationOnEnterprisePlan: vi.fn(),
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({ getWorkspaceWithOwner: vi.fn() }))
vi.mock('@/providers/utils', () => ({
  isFunctionToolCall: () => false,
  getProviderFromModel: () => 'openai',
}))

import type { ExecutionContext } from '@/executor/types'
import {
  assertPermissionsAllowed,
  ToolNotAllowedError,
  validateModelProvider,
} from './permission-check'

/**
 * A run's own metadata carries its gate subject. Only a trigger whose acting
 * person differs from the one it bills declares one; everything else omits the
 * field and keeps gating on the caller.
 */
function runDeclaring(capabilityGovernedUserId?: string | null): ExecutionContext {
  return { metadata: { capabilityGovernedUserId } } as unknown as ExecutionContext
}

describe('the subject a run’s permission gate is decided about', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUserPermissionConfig.mockResolvedValue({ deniedTools: ['exa_search'] })
  })

  /**
   * A table cell dispatched by a workspace API key attributes to the
   * workspace's billing owner. Loading that bystander's group runs a denylist
   * nobody asked for and skips the one belonging to whoever actually asked.
   */
  it('resolves the declared subject’s group, not the billing actor’s', async () => {
    await expect(
      assertPermissionsAllowed({
        userId: 'workspace-billing-owner',
        workspaceId: 'workspace-1',
        toolId: 'exa_search',
        ctx: runDeclaring('requesting-member'),
      })
    ).rejects.toBeInstanceOf(ToolNotAllowedError)

    expect(mocks.getUserPermissionConfig).toHaveBeenCalledWith('requesting-member', 'workspace-1')
    expect(mocks.getUserPermissionConfig).not.toHaveBeenCalledWith(
      'workspace-billing-owner',
      'workspace-1'
    )
  })

  /** A declared `null` is the actorless run: there is no group to consult. */
  it('consults no group when the run declares no acting person', async () => {
    await assertPermissionsAllowed({
      userId: 'workspace-billing-owner',
      workspaceId: 'workspace-1',
      toolId: 'exa_search',
      ctx: runDeclaring(null),
    })

    expect(mocks.getUserPermissionConfig).not.toHaveBeenCalled()
  })

  /** Every surface with exactly one person declares nothing and is unchanged. */
  it('keeps gating on the caller when the run declares nothing', async () => {
    await expect(
      assertPermissionsAllowed({
        userId: 'user-123',
        workspaceId: 'workspace-1',
        toolId: 'exa_search',
        ctx: runDeclaring(),
      })
    ).rejects.toBeInstanceOf(ToolNotAllowedError)

    expect(mocks.getUserPermissionConfig).toHaveBeenCalledWith('user-123', 'workspace-1')
  })

  it('keeps gating on the caller when there is no run context at all', async () => {
    await expect(
      assertPermissionsAllowed({
        userId: 'user-123',
        workspaceId: 'workspace-1',
        toolId: 'exa_search',
      })
    ).rejects.toBeInstanceOf(ToolNotAllowedError)

    expect(mocks.getUserPermissionConfig).toHaveBeenCalledWith('user-123', 'workspace-1')
  })
})

/**
 * The run-scoped memo on `ExecutionContext` is keyed by nothing but the
 * context, so whichever check loads first decides whose group every later check
 * on that run reads. `validateModelProvider` takes the actor positionally, and
 * the agent handler calls it before the skill gate — so a delegated run whose
 * gate subject differs from its billing actor had the model check cache the
 * bystander's group and hand it to `assertPermissionsAllowed`, which had
 * correctly resolved the governed subject and then never used it.
 */
describe('the group a run’s later gates read from its cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUserPermissionConfig.mockResolvedValue({
      allowedModelProviders: ['openai'],
      deniedTools: ['exa_search'],
    })
  })

  it('is the governed subject’s, even when a model check loaded it first', async () => {
    const ctx = runDeclaring('requesting-member')

    await validateModelProvider('workspace-billing-owner', 'workspace-1', 'gpt-4', ctx)

    expect(mocks.getUserPermissionConfig).toHaveBeenCalledExactlyOnceWith(
      'requesting-member',
      'workspace-1'
    )

    await expect(
      assertPermissionsAllowed({
        userId: 'workspace-billing-owner',
        workspaceId: 'workspace-1',
        toolId: 'exa_search',
        ctx,
      })
    ).rejects.toBeInstanceOf(ToolNotAllowedError)

    expect(mocks.getUserPermissionConfig).toHaveBeenCalledExactlyOnceWith(
      'requesting-member',
      'workspace-1'
    )
  })

  /** An actorless run consults no group, whichever check runs first. */
  it('is nobody’s when the run declares no acting person', async () => {
    const ctx = runDeclaring(null)

    await validateModelProvider('workspace-billing-owner', 'workspace-1', 'gpt-4', ctx)
    await assertPermissionsAllowed({
      userId: 'workspace-billing-owner',
      workspaceId: 'workspace-1',
      toolId: 'exa_search',
      ctx,
    })

    expect(mocks.getUserPermissionConfig).not.toHaveBeenCalled()
  })
})
