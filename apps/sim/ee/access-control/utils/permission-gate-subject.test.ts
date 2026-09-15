/**
 * @vitest-environment node
 */
import { DrizzleQueryError } from 'drizzle-orm/errors'
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
vi.mock('@sim/utils/helpers', () => ({ sleep: vi.fn().mockResolvedValue(undefined) }))
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
  return {
    metadata: { capabilityGovernedUserId },
    permissionConfigCache: new Map(),
  } as unknown as ExecutionContext
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

function databaseError(code = 'ECONNRESET'): DrizzleQueryError {
  return new DrizzleQueryError(
    'select "billing_blocked" from "user_stats" where "user_stats"."user_id" = $1',
    ['owner-secret-id'],
    Object.assign(new Error(`driver failure ${code}`), { code })
  )
}

/** Every block runs on a shallow copy of the run's context, so the memo lives in a Map they share. */
describe('the run-scoped permission config cache', () => {
  function runContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
    return {
      metadata: {},
      permissionConfigCache: new Map(),
      ...overrides,
    } as unknown as ExecutionContext
  }

  function gate(ctx: ExecutionContext, workspaceId = 'workspace-1') {
    return assertPermissionsAllowed({
      userId: 'user-1',
      workspaceId,
      toolId: 'http_request',
      ctx,
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUserPermissionConfig.mockResolvedValue({ deniedTools: [] })
  })

  it('loads once across the per-block copies of one run', async () => {
    const run = runContext()

    await gate({ ...run })
    await gate({ ...run })

    expect(mocks.getUserPermissionConfig).toHaveBeenCalledExactlyOnceWith('user-1', 'workspace-1')
  })

  it('shares one in-flight load between concurrent parallel branches', async () => {
    const run = runContext()
    let release!: (config: unknown) => void
    mocks.getUserPermissionConfig.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      })
    )

    const branches = Promise.all(Array.from({ length: 5 }, () => gate({ ...run })))
    release({ deniedTools: [] })
    await branches

    expect(mocks.getUserPermissionConfig).toHaveBeenCalledTimes(1)
  })

  it('keeps a separate entry per workspace', async () => {
    const run = runContext()
    mocks.getUserPermissionConfig.mockImplementation(async (_userId, workspaceId) =>
      workspaceId === 'workspace-2' ? { deniedTools: ['http_request'] } : { deniedTools: [] }
    )

    await gate({ ...run }, 'workspace-1')
    await expect(gate({ ...run }, 'workspace-2')).rejects.toBeInstanceOf(ToolNotAllowedError)

    expect(mocks.getUserPermissionConfig).toHaveBeenCalledTimes(2)
  })

  it('evicts a failed load so a later gate loads again', async () => {
    const run = runContext()
    mocks.getUserPermissionConfig.mockRejectedValueOnce(new Error('config unavailable'))

    await expect(gate({ ...run })).rejects.toThrow('config unavailable')
    await gate({ ...run })

    expect(mocks.getUserPermissionConfig).toHaveBeenCalledTimes(2)
  })

  it('retries a transient database failure and then caches the result', async () => {
    const run = runContext()
    mocks.getUserPermissionConfig.mockRejectedValueOnce(databaseError())

    await gate({ ...run })
    await gate({ ...run })

    expect(mocks.getUserPermissionConfig).toHaveBeenCalledTimes(2)
  })

  it('does not retry a database failure that is not transient', async () => {
    const sqlError = databaseError('42703')
    mocks.getUserPermissionConfig.mockRejectedValue(sqlError)

    await expect(gate(runContext())).rejects.toBe(sqlError)
    expect(mocks.getUserPermissionConfig).toHaveBeenCalledTimes(1)
  })

  it('fails closed with the last error once retries are exhausted', async () => {
    const error = databaseError()
    mocks.getUserPermissionConfig.mockRejectedValue(error)

    await expect(gate(runContext())).rejects.toBe(error)
    expect(mocks.getUserPermissionConfig).toHaveBeenCalledTimes(3)
  })

  it('stops retrying when the run is cancelled', async () => {
    const controller = new AbortController()
    const reason = new Error('Execution cancelled')
    mocks.getUserPermissionConfig.mockImplementationOnce(async () => {
      controller.abort(reason)
      throw databaseError()
    })

    await expect(gate(runContext({ abortSignal: controller.signal }))).rejects.toBe(reason)
    expect(mocks.getUserPermissionConfig).toHaveBeenCalledTimes(1)
  })

  it('does not memoize on a context that carries no run cache', async () => {
    const ctx = { metadata: {} } as unknown as ExecutionContext

    await gate(ctx)
    await gate(ctx)

    expect(mocks.getUserPermissionConfig).toHaveBeenCalledTimes(2)
    expect(ctx.permissionConfigCache).toBeUndefined()
  })

  it('retries a transient failure for a check made outside a run', async () => {
    mocks.getUserPermissionConfig.mockRejectedValueOnce(databaseError())

    await assertPermissionsAllowed({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      toolId: 'http_request',
    })

    expect(mocks.getUserPermissionConfig).toHaveBeenCalledTimes(2)
  })
})
