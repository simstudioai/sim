import { permissionGroupScopeMock, permissionGroupScopeMockFns } from '@sim/testing'
import {
  createDelegatedPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import { rateLimiterMock, rateLimiterMockFns } from '@sim/testing/mocks/rate-limiter.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceUploadsMock,
  workspaceUploadsMockFns,
} from '@sim/testing/mocks/workspace-uploads.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { hoisted } = vi.hoisted(() => ({
  hoisted: {
    listPage: vi.fn(),
    read: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))

const resolveGroupConfigMock = permissionGroupScopeMockFns.mockResolvePermissionGroupConfig

vi.mock('@/lib/uploads/contexts/workspace', () => workspaceUploadsMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)
vi.mock('@/lib/core/rate-limiter', () => rateLimiterMock)
vi.mock('@/lib/execution/remote-sandbox/workspace-sandboxes', () => ({
  SANDBOX_MUTATION_LIMIT: { maxTokens: 20, refillRate: 10, refillIntervalMs: 60_000 },
  createWorkspaceSandbox: hoisted.create,
  currentSandboxStrategy: () => 'prebuilt',
  deleteWorkspaceSandbox: hoisted.remove,
  listWorkspaceSandboxesPage: hoisted.listPage,
  readWorkspaceSandbox: hoisted.read,
  updateWorkspaceSandbox: hoisted.update,
}))

import {
  ForbiddenOperationError,
  InsufficientWorkspacePermissionsError,
  PermissionGroupCapabilityError,
  WorkspaceApiKeyAuthorizationError,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { SANDBOX_DELEGATION_AUDIENCE } from '@/lib/sandboxes/application/authorization'
import { SandboxBuildBudgetExceededError } from '@/lib/sandboxes/application/build-budget'
import {
  createWorkspaceSandboxUseCase,
  deleteWorkspaceSandboxUseCase,
  getWorkspaceSandboxUseCase,
  listWorkspaceSandboxesUseCase,
  updateWorkspaceSandboxUseCase,
} from '@/lib/sandboxes/application/use-cases'

const mocks = {
  ...hoisted,
  loadContext: workspaceUploadsMockFns.mockLoadActiveWorkspaceContext,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  hasAccess: billingSubscriptionMockFns.mockHasWorkspaceSandboxAccess,
  budget: rateLimiterMockFns.mockCheckRateLimitDirect,
  audit: auditMockFns.mockRecordAudit,
}

const workspace = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'owner-1',
}
const sandbox = {
  id: 'sandbox-1',
  name: 'data-tools',
  language: 'python' as const,
  dependencies: ['pandas'],
  cliTools: [],
  systemPackages: ['graphviz'],
  buildStatus: 'ready' as const,
  errorCode: null,
  errorMessage: null,
  errorDetail: null,
  builtAt: '2026-08-04T12:00:00.000Z',
  createdAt: '2026-08-04T11:00:00.000Z',
  updatedAt: '2026-08-04T12:00:00.000Z',
}
const session = createSessionPrincipal()
const workspaceKey = createWorkspaceApiKeyPrincipal({
  workspaceId: workspace.workspaceId,
  keyId: 'workspace-key-1',
})
const BUDGET_OK = { allowed: true, remaining: 19, resetAt: new Date('2026-08-04T12:01:00Z') }
const createInput = {
  workspaceId: workspace.workspaceId,
  name: 'data-tools',
  language: 'python' as const,
  dependencies: ['pandas'],
  source: 'api' as const,
}

function copilotPrincipal(overrides: Parameters<typeof createDelegatedPrincipal>[0] = {}) {
  return createDelegatedPrincipal({
    workspaceId: workspace.workspaceId,
    delegationId: 'copilot-tool:call-1',
    audience: SANDBOX_DELEGATION_AUDIENCE,
    ...overrides,
  })
}

describe('sandbox application use cases', () => {
  beforeEach(() => {
    mocks.loadContext.mockResolvedValue(workspace)
    mocks.resolvePermission.mockResolvedValue('admin')
    resolveGroupConfigMock.mockResolvedValue(DEFAULT_PERMISSION_GROUP_CONFIG)
    mocks.hasAccess.mockResolvedValue(true)
    mocks.budget.mockResolvedValue(BUDGET_OK)
    mocks.listPage.mockResolvedValue({ data: [sandbox], nextCursorKeys: null })
    mocks.read.mockResolvedValue(sandbox)
    mocks.create.mockImplementation(async (_workspaceId, _createdBy, _input, options) => {
      await options?.admit?.()
      return sandbox
    })
    mocks.update.mockImplementation(async (_workspaceId, _sandboxId, _input, options) => {
      await options?.admit?.()
      return sandbox
    })
    mocks.remove.mockResolvedValue(undefined)
  })

  describe('list', () => {
    it('reads at member role, reports entitlement, and never spends the build budget', async () => {
      mocks.resolvePermission.mockResolvedValue('read')
      mocks.hasAccess.mockResolvedValue(false)

      const result = await listWorkspaceSandboxesUseCase.execute({
        principal: session,
        input: { workspaceId: workspace.workspaceId, sortBy: 'name', sortOrder: 'asc' },
      })

      expect(result).toEqual({
        sandboxes: [sandbox],
        nextCursorKeys: null,
        strategy: 'prebuilt',
        entitled: false,
        sortBy: 'name',
        sortOrder: 'asc',
      })
      expect(mocks.listPage).toHaveBeenCalledWith({
        workspaceId: workspace.workspaceId,
        sortBy: 'name',
        sortOrder: 'asc',
      })
      expect(mocks.budget).not.toHaveBeenCalled()
      expect(mocks.audit).not.toHaveBeenCalled()
    })

    it('pages for a workspace API key and hands back the resume keys', async () => {
      mocks.listPage.mockResolvedValue({
        data: [sandbox],
        nextCursorKeys: ['data-tools', 'sandbox-1'],
      })

      const result = await listWorkspaceSandboxesUseCase.execute({
        principal: workspaceKey,
        input: {
          workspaceId: workspace.workspaceId,
          search: 'data',
          sortBy: 'name',
          sortOrder: 'asc',
          limit: 1,
          cursorKeys: undefined,
        },
      })

      expect(result.nextCursorKeys).toEqual(['data-tools', 'sandbox-1'])
      expect(mocks.listPage).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: workspace.workspaceId, search: 'data', limit: 1 })
      )
      expect(mocks.resolvePermission).not.toHaveBeenCalled()
    })
  })

  describe('read', () => {
    it('conceals a sandbox from another workspace as absent', async () => {
      mocks.read.mockResolvedValue(null)

      await expect(
        getWorkspaceSandboxUseCase.execute({
          principal: session,
          input: { workspaceId: workspace.workspaceId, sandboxId: 'sandbox-elsewhere' },
        })
      ).rejects.toMatchObject({ code: 'not_found', message: 'Sandbox not found' })
      expect(mocks.read).toHaveBeenCalledWith(workspace.workspaceId, 'sandbox-elsewhere')
    })
  })

  describe('create', () => {
    it('admits an admin on a Max plan, records the actor as creator, and audits the result', async () => {
      const result = await createWorkspaceSandboxUseCase.execute({
        principal: session,
        input: createInput,
      })

      expect(result).toEqual({ sandbox })
      expect(mocks.hasAccess).toHaveBeenCalledWith(workspace.workspaceId)
      expect(mocks.budget).toHaveBeenCalledWith(
        'route:sandbox-mutations:workspace:workspace-1',
        expect.objectContaining({ maxTokens: 20 })
      )
      expect(mocks.create).toHaveBeenCalledWith(
        workspace.workspaceId,
        'user-1',
        {
          name: 'data-tools',
          language: 'python',
          dependencies: ['pandas'],
          cliTools: [],
          systemPackages: [],
        },
        { admit: expect.any(Function) }
      )
      expect(mocks.audit).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: workspace.workspaceId,
          actorId: 'user-1',
          action: 'sandbox.created',
          resourceType: 'sandbox',
          resourceId: sandbox.id,
          resourceName: sandbox.name,
          metadata: expect.objectContaining({
            source: 'api',
            language: 'python',
            operation: 'sandboxes.create',
          }),
        })
      )
    })

    it('refuses a workspace key before loading anything', async () => {
      await expect(
        createWorkspaceSandboxUseCase.execute({ principal: workspaceKey, input: createInput })
      ).rejects.toBeInstanceOf(WorkspaceApiKeyAuthorizationError)
      expect(mocks.loadContext).not.toHaveBeenCalled()
      expect(mocks.create).not.toHaveBeenCalled()
    })

    it('refuses a writer who is not an admin, before the plan or the budget', async () => {
      mocks.resolvePermission.mockResolvedValue('write')

      await expect(
        createWorkspaceSandboxUseCase.execute({ principal: session, input: createInput })
      ).rejects.toBeInstanceOf(InsufficientWorkspacePermissionsError)
      expect(mocks.hasAccess).not.toHaveBeenCalled()
      expect(mocks.budget).not.toHaveBeenCalled()
      expect(mocks.audit).not.toHaveBeenCalled()
    })

    it('refuses a cohort whose permission group withholds the module', async () => {
      resolveGroupConfigMock.mockResolvedValue({
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        hideSandboxesTab: true,
      })

      await expect(
        createWorkspaceSandboxUseCase.execute({ principal: session, input: createInput })
      ).rejects.toBeInstanceOf(PermissionGroupCapabilityError)
      expect(mocks.create).not.toHaveBeenCalled()
    })

    it('names the plan as the remedy below the Max tier and spends no budget', async () => {
      mocks.hasAccess.mockResolvedValue(false)

      const failure = await createWorkspaceSandboxUseCase
        .execute({ principal: session, input: createInput })
        .catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(ForbiddenOperationError)
      expect(failure).toMatchObject({
        detailCode: 'WORKSPACE_PLAN_CAPABILITY_REQUIRED',
        message: expect.stringContaining('Max or Enterprise'),
      })
      expect(mocks.budget).not.toHaveBeenCalled()
      expect(mocks.create).not.toHaveBeenCalled()
      expect(mocks.audit).not.toHaveBeenCalled()
    })

    it('refuses once the workspace build budget is spent, without writing', async () => {
      mocks.budget.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: new Date(Date.now() + 30_000),
        retryAfterMs: 30_000,
      })

      await expect(
        createWorkspaceSandboxUseCase.execute({ principal: session, input: createInput })
      ).rejects.toBeInstanceOf(SandboxBuildBudgetExceededError)
      expect(mocks.audit).not.toHaveBeenCalled()
    })

    /**
     * The budget is the manager's admission hook, not an up-front charge: a
     * spec the manager refuses, or a name it finds taken, never reaches the
     * hook, so a stream of rejected requests cannot drain what a real build
     * needs. The manager test pins where the hook fires; this pins that the
     * use case spends nothing on its own.
     */
    it('spends the budget only through the admission hook the manager owns', async () => {
      mocks.create.mockRejectedValue(new OrchestrationError('validation', 'invalid package name'))

      await expect(
        createWorkspaceSandboxUseCase.execute({ principal: session, input: createInput })
      ).rejects.toMatchObject({ code: 'validation' })
      expect(mocks.budget).not.toHaveBeenCalled()
      expect(mocks.audit).not.toHaveBeenCalled()
    })

    it('acts as the person behind a trusted Copilot delegation', async () => {
      await createWorkspaceSandboxUseCase.execute({
        principal: copilotPrincipal(),
        input: { ...createInput, source: 'tool_input' },
      })

      expect(mocks.resolvePermission).toHaveBeenCalledWith(
        'user-1',
        workspace.workspaceId,
        workspace.workspaceOrganizationId,
        undefined,
        expect.anything()
      )
      expect(mocks.create).toHaveBeenCalledWith(
        workspace.workspaceId,
        'user-1',
        expect.objectContaining({ name: 'data-tools' }),
        { admit: expect.any(Function) }
      )
    })

    it('rejects a delegation minted for another audience', async () => {
      await expect(
        createWorkspaceSandboxUseCase.execute({
          principal: copilotPrincipal({ audience: 'sim:custom-tools' }),
          input: createInput,
        })
      ).rejects.toMatchObject({ code: 'forbidden' })
      expect(mocks.create).not.toHaveBeenCalled()
    })
  })

  describe('update', () => {
    it('applies the supplied fields to the canonical sandbox and audits it', async () => {
      const result = await updateWorkspaceSandboxUseCase.execute({
        principal: session,
        input: {
          workspaceId: workspace.workspaceId,
          sandboxId: sandbox.id,
          dependencies: ['pandas', 'numpy'],
          source: 'settings',
        },
      })

      expect(result).toEqual({ sandbox })
      expect(mocks.update).toHaveBeenCalledWith(
        workspace.workspaceId,
        sandbox.id,
        {
          name: undefined,
          language: undefined,
          dependencies: ['pandas', 'numpy'],
          cliTools: undefined,
          systemPackages: undefined,
        },
        { admit: expect.any(Function) }
      )
      expect(mocks.budget).toHaveBeenCalledTimes(1)
      expect(mocks.audit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'sandbox.updated', resourceId: sandbox.id })
      )
    })

    it('answers not found before admission for a sandbox the workspace does not hold', async () => {
      mocks.read.mockResolvedValue(null)

      await expect(
        updateWorkspaceSandboxUseCase.execute({
          principal: session,
          input: { workspaceId: workspace.workspaceId, sandboxId: 'missing', name: 'renamed' },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      expect(mocks.hasAccess).not.toHaveBeenCalled()
      expect(mocks.update).not.toHaveBeenCalled()
    })
  })

  describe('delete', () => {
    it('deletes the canonical sandbox and audits from the record it held', async () => {
      const result = await deleteWorkspaceSandboxUseCase.execute({
        principal: session,
        input: { workspaceId: workspace.workspaceId, sandboxId: sandbox.id, source: 'api' },
      })

      expect(result).toEqual({ sandbox })
      expect(mocks.remove).toHaveBeenCalledWith(workspace.workspaceId, sandbox.id)
      expect(mocks.audit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'sandbox.deleted',
          resourceId: sandbox.id,
          resourceName: sandbox.name,
        })
      )
    })

    /**
     * Deleting builds nothing, and a workspace that spent its budget on saves
     * must still be able to clean up.
     */
    it('never spends the write budget on a delete', async () => {
      mocks.budget.mockResolvedValue({ allowed: false, remaining: 0, resetAt: new Date() })

      await expect(
        deleteWorkspaceSandboxUseCase.execute({
          principal: session,
          input: { workspaceId: workspace.workspaceId, sandboxId: sandbox.id },
        })
      ).resolves.toEqual({ sandbox })
      expect(mocks.budget).not.toHaveBeenCalled()
    })

    it('does not audit a delete the manager refused', async () => {
      mocks.remove.mockRejectedValue(new OrchestrationError('not_found', 'Sandbox not found'))

      await expect(
        deleteWorkspaceSandboxUseCase.execute({
          principal: session,
          input: { workspaceId: workspace.workspaceId, sandboxId: sandbox.id },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      expect(mocks.audit).not.toHaveBeenCalled()
    })
  })
})
