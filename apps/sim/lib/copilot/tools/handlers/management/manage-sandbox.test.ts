/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks, useCases } = vi.hoisted(() => ({
  mocks: {
    sandbox: vi.fn(),
  },
  useCases: {
    list: { operation: { id: 'sandboxes.list' } },
    create: { operation: { id: 'sandboxes.create' } },
    update: { operation: { id: 'sandboxes.update' } },
    delete: { operation: { id: 'sandboxes.delete' } },
  },
}))

vi.mock('@/lib/copilot/application/execute-sandbox-use-case', () => ({
  executeCopilotSandboxUseCase: mocks.sandbox,
}))
vi.mock('@/lib/sandboxes/application/use-cases', () => ({
  listWorkspaceSandboxesUseCase: useCases.list,
  createWorkspaceSandboxUseCase: useCases.create,
  updateWorkspaceSandboxUseCase: useCases.update,
  deleteWorkspaceSandboxUseCase: useCases.delete,
}))
vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = vi.fn()
  },
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
vi.mock('@/lib/execution/remote-sandbox/workspace-sandboxes', async () => {
  const { OrchestrationError } = await import('@/lib/core/orchestration/types')
  class SandboxDependencyError extends OrchestrationError {
    constructor(readonly issues: { line: number; value: string; reason: string }[]) {
      super('validation', issues[0]?.reason ?? 'Invalid dependency list')
    }
  }
  class SandboxSystemPackageError extends OrchestrationError {
    constructor(readonly issues: { line: number; value: string; reason: string }[]) {
      super('validation', issues[0]?.reason ?? 'Invalid system package list')
    }
  }
  return {
    SANDBOX_MUTATION_LIMIT: { maxTokens: 20, refillRate: 10, refillIntervalMs: 60_000 },
    SandboxDependencyError,
    SandboxSystemPackageError,
  }
})

import type { ExecutionContext } from '@/lib/copilot/request/types'
import { ForbiddenOperationError } from '@/lib/core/application'
import { MAX_PLAN_REQUIRED } from '@/lib/execution/remote-sandbox/entitlement'
import { SandboxDependencyError } from '@/lib/execution/remote-sandbox/workspace-sandboxes'
import { SandboxBuildBudgetExceededError } from '@/lib/sandboxes/application/build-budget'
import { executeManageSandbox } from './manage-sandbox'

const context: ExecutionContext = {
  userId: 'user-1',
  workflowId: '',
  workspaceId: 'workspace-1',
  chatId: 'chat-1',
  toolCallId: 'call-1',
  copilotToolExecution: true,
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
    mocks.sandbox.mockResolvedValue({
      sandboxes: [sandbox],
      nextCursorKeys: null,
      strategy: 'prebuilt',
      entitled: true,
      sortBy: 'name',
      sortOrder: 'asc',
    })
  })

  it('lists through the shared use case and returns the authoritative CLI catalog', async () => {
    const result = await executeManageSandbox({ operation: 'list' }, context)

    expect(mocks.sandbox).toHaveBeenCalledWith(context, useCases.list, {
      workspaceId: 'workspace-1',
      sortBy: 'name',
      sortOrder: 'asc',
    })
    expect(result).toMatchObject({
      success: true,
      output: {
        strategy: 'prebuilt',
        entitled: true,
        count: 1,
        sandboxes: [sandbox],
        availableCliTools: [{ id: 'kubectl@1.36.3-r1' }],
      },
    })
  })

  /**
   * The list is a read, so a workspace below the Max tier still sees what it
   * built; `entitled: false` is how the model learns that writes will be
   * refused, instead of a refusal that hid the list.
   */
  it('still lists below the Max tier and reports that writes will be refused', async () => {
    mocks.sandbox.mockResolvedValue({
      sandboxes: [sandbox],
      nextCursorKeys: null,
      strategy: 'prebuilt',
      entitled: false,
      sortBy: 'name',
      sortOrder: 'asc',
    })

    const result = await executeManageSandbox({ operation: 'list' }, context)

    expect(result).toMatchObject({ success: true, output: { entitled: false, count: 1 } })
  })

  it('ignores a model-supplied workspace in favor of the server context', async () => {
    await executeManageSandbox({ operation: 'list', workspaceId: 'model-workspace' }, context)

    expect(mocks.sandbox).toHaveBeenCalledWith(
      context,
      useCases.list,
      expect.objectContaining({ workspaceId: 'workspace-1' })
    )
  })

  it('validates then creates through the shared use case', async () => {
    mocks.sandbox.mockResolvedValue({ sandbox })

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

    expect(mocks.sandbox).toHaveBeenCalledWith(context, useCases.create, {
      workspaceId: 'workspace-1',
      name: 'data-tools',
      language: 'python',
      dependencies: ['pandas'],
      cliTools: ['kubectl@1.36.3-r1'],
      systemPackages: ['graphviz'],
      source: 'tool_input',
    })
    expect(result).toMatchObject({ success: true, output: { sandboxId: 'sandbox-1' } })
  })

  it('rejects a malformed add before reaching the use case', async () => {
    const result = await executeManageSandbox(
      { operation: 'add', name: '', language: 'python' },
      context
    )

    expect(result.success).toBe(false)
    expect(mocks.sandbox).not.toHaveBeenCalled()
  })

  it('edits and deletes the sandbox the model named', async () => {
    mocks.sandbox.mockResolvedValue({ sandbox })

    await executeManageSandbox(
      { operation: 'edit', sandboxId: 'sandbox-1', dependencies: ['pandas', 'numpy'] },
      context
    )
    expect(mocks.sandbox).toHaveBeenCalledWith(context, useCases.update, {
      workspaceId: 'workspace-1',
      sandboxId: 'sandbox-1',
      dependencies: ['pandas', 'numpy'],
      source: 'tool_input',
    })

    mocks.sandbox.mockResolvedValue({ sandbox })
    const deleted = await executeManageSandbox(
      { operation: 'delete', sandboxId: 'sandbox-1' },
      context
    )
    expect(mocks.sandbox).toHaveBeenCalledWith(context, useCases.delete, {
      workspaceId: 'workspace-1',
      sandboxId: 'sandbox-1',
      source: 'tool_input',
    })
    expect(deleted).toMatchObject({ success: true, output: { sandboxId: 'sandbox-1' } })
  })

  it('requires a sandbox id for edit and delete', async () => {
    const result = await executeManageSandbox({ operation: 'delete' }, context)

    expect(result).toMatchObject({ success: false, error: expect.stringContaining('sandboxId') })
    expect(mocks.sandbox).not.toHaveBeenCalled()
  })

  it('surfaces the plan refusal the use case raised', async () => {
    mocks.sandbox.mockRejectedValue(
      new ForbiddenOperationError('WORKSPACE_PLAN_CAPABILITY_REQUIRED', MAX_PLAN_REQUIRED)
    )

    const result = await executeManageSandbox(
      { operation: 'add', name: 'data-tools', language: 'python' },
      context
    )

    expect(result).toEqual({ success: false, error: MAX_PLAN_REQUIRED })
  })

  it('tells the model not to retry a spent build budget', async () => {
    mocks.sandbox.mockRejectedValue(
      new SandboxBuildBudgetExceededError(new Date(Date.now() + 60_000), 60_000)
    )

    const result = await executeManageSandbox(
      { operation: 'add', name: 'data-tools', language: 'python' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('do not retry now')
  })

  it('addresses a refused dependency line back to its row', async () => {
    mocks.sandbox.mockRejectedValue(
      new SandboxDependencyError([{ line: 2, value: 'not a package!', reason: 'invalid name' }])
    )

    const result = await executeManageSandbox(
      { operation: 'add', name: 'data-tools', language: 'python', dependencies: ['a', 'b'] },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('dependencies line 2')
  })

  it('hides an unclassified failure behind the retry guidance', async () => {
    mocks.sandbox.mockRejectedValue(new Error('connection refused'))

    const result = await executeManageSandbox(
      { operation: 'delete', sandboxId: 'sandbox-1' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).not.toContain('connection refused')
    expect(result.error).toContain('run operation "list"')
  })
})
