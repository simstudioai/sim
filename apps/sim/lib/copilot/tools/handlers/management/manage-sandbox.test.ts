/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  hasAccess: vi.fn(),
  enforceRateLimit: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  getPermission: vi.fn(),
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  hasWorkspaceSandboxAccess: mocks.hasAccess,
}))

vi.mock('@/lib/core/rate-limiter/route-helpers', () => ({
  enforceWorkspaceRateLimit: mocks.enforceRateLimit,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mocks.getPermission,
}))

vi.mock('@/lib/execution/remote-sandbox/cli-tools', () => ({
  SANDBOX_CLI_TOOL_IDS: ['kubectl@1.36.3-r1'],
  MAX_SANDBOX_CLI_TOOLS: 10,
  SANDBOX_CLI_TOOLS: {
    'kubectl@1.36.3-r1': {
      id: 'kubectl@1.36.3-r1',
      label: 'kubectl',
      description: 'Control Kubernetes clusters.',
      category: 'Kubernetes',
    },
  },
}))

vi.mock('@/lib/execution/remote-sandbox/workspace-sandboxes', () => {
  class SandboxDependencyError extends Error {
    issues: unknown[] = []
  }
  class SandboxSystemPackageError extends Error {
    issues: unknown[] = []
  }
  class WorkspaceSandboxNameConflictError extends Error {}
  class WorkspaceSandboxNotFoundError extends Error {}
  return {
    createWorkspaceSandbox: mocks.create,
    updateWorkspaceSandbox: mocks.update,
    deleteWorkspaceSandbox: mocks.remove,
    listWorkspaceSandboxes: mocks.list,
    currentSandboxStrategy: () => 'prebuilt',
    MAX_PLAN_REQUIRED: 'Sim sandboxes require an active Max or Enterprise plan.',
    SANDBOX_ADMIN_REQUIRED: 'Only workspace admins can manage Sim sandboxes',
    SANDBOX_MUTATION_LIMIT: { maxTokens: 20, refillRate: 10, refillIntervalMs: 60_000 },
    SandboxDependencyError,
    SandboxSystemPackageError,
    WorkspaceSandboxNameConflictError,
    WorkspaceSandboxNotFoundError,
  }
})

import type { ExecutionContext } from '@/lib/copilot/request/types'
import { executeManageSandbox } from './manage-sandbox'

const context: ExecutionContext = {
  userId: 'user-1',
  workflowId: '',
  workspaceId: 'workspace-1',
  userPermission: 'admin',
}

const sandbox = {
  id: 'sandbox-1',
  name: 'data-tools',
  language: 'python' as const,
  dependencies: ['pandas'],
  cliTools: ['kubectl@1.36.3-r1'],
  systemPackages: ['graphviz'],
  buildStatus: 'ready' as const,
  errorCode: null,
  errorMessage: null,
  errorDetail: null,
  builtAt: '2026-08-04T12:00:00.000Z',
  createdAt: '2026-08-04T11:00:00.000Z',
  updatedAt: '2026-08-04T12:00:00.000Z',
}

describe('executeManageSandbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hasAccess.mockResolvedValue(true)
    mocks.getPermission.mockResolvedValue('admin')
    mocks.enforceRateLimit.mockResolvedValue(null)
    mocks.list.mockResolvedValue([sandbox])
    mocks.create.mockResolvedValue(sandbox)
  })

  it('fails closed before discovery when the workspace is not entitled', async () => {
    mocks.hasAccess.mockResolvedValue(false)

    const result = await executeManageSandbox({ operation: 'list' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Max or Enterprise')
    expect(mocks.getPermission).toHaveBeenCalledWith('user-1', 'workspace', 'workspace-1')
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('rechecks current admin permission in Sim instead of trusting request context', async () => {
    mocks.getPermission.mockResolvedValue('write')

    const result = await executeManageSandbox({ operation: 'list' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('workspace admins')
    expect(mocks.hasAccess).not.toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('lists through the shared sandbox service and returns the authoritative CLI catalog', async () => {
    const result = await executeManageSandbox({ operation: 'list' }, context)

    expect(mocks.list).toHaveBeenCalledWith('workspace-1')
    expect(result).toMatchObject({
      success: true,
      output: {
        strategy: 'prebuilt',
        count: 1,
        sandboxes: [sandbox],
        availableCliTools: [{ id: 'kubectl@1.36.3-r1' }],
      },
    })
  })

  it('validates then creates through the shared sandbox service', async () => {
    const result = await executeManageSandbox(
      {
        operation: 'add',
        name: ' data-tools ',
        language: 'python',
        dependencies: ['pandas'],
        cliTools: ['kubectl@1.36.3-r1'],
        systemPackages: ['graphviz'],
      },
      context
    )

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith(
      'sandbox-mutations',
      'workspace-1',
      expect.any(Object)
    )
    expect(mocks.create).toHaveBeenCalledWith('workspace-1', 'user-1', {
      name: 'data-tools',
      language: 'python',
      dependencies: ['pandas'],
      cliTools: ['kubectl@1.36.3-r1'],
      systemPackages: ['graphviz'],
    })
    expect(result).toMatchObject({ success: true, output: { sandboxId: 'sandbox-1' } })
  })
})
