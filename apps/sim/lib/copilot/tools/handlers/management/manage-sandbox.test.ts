/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@/lib/copilot/request/types'

const {
  getUserEntityPermissionsMock,
  hasWorkspaceSandboxAccessMock,
  enforceWorkspaceRateLimitMock,
  createWorkspaceSandboxMock,
  updateWorkspaceSandboxMock,
  deleteWorkspaceSandboxMock,
  listWorkspaceSandboxesMock,
} = vi.hoisted(() => ({
  getUserEntityPermissionsMock: vi.fn(),
  hasWorkspaceSandboxAccessMock: vi.fn(),
  enforceWorkspaceRateLimitMock: vi.fn(),
  createWorkspaceSandboxMock: vi.fn(),
  updateWorkspaceSandboxMock: vi.fn(),
  deleteWorkspaceSandboxMock: vi.fn(),
  listWorkspaceSandboxesMock: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: getUserEntityPermissionsMock,
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  hasWorkspaceSandboxAccess: hasWorkspaceSandboxAccessMock,
}))

vi.mock('@/lib/core/rate-limiter/route-helpers', () => ({
  enforceWorkspaceRateLimit: enforceWorkspaceRateLimitMock,
}))

vi.mock('@/lib/execution/remote-sandbox/workspace-sandboxes', () => ({
  createWorkspaceSandbox: createWorkspaceSandboxMock,
  updateWorkspaceSandbox: updateWorkspaceSandboxMock,
  deleteWorkspaceSandbox: deleteWorkspaceSandboxMock,
  listWorkspaceSandboxes: listWorkspaceSandboxesMock,
  currentSandboxStrategy: () => 'prebuilt',
  MAX_PLAN_REQUIRED: 'Sandboxes require an active Max or Enterprise plan.',
  SANDBOX_ADMIN_REQUIRED: 'Only workspace admins can manage sandboxes',
  SANDBOX_MUTATION_LIMIT: { maxTokens: 20, refillRate: 10, refillIntervalMs: 60_000 },
}))

import { executeManageSandbox } from '@/lib/copilot/tools/handlers/management/manage-sandbox'

const context = { userId: 'user-1', workflowId: 'wf-1', workspaceId: 'ws-1' } as ExecutionContext

const sandbox = {
  id: 'sb-1',
  name: 'data-tools',
  language: 'python' as const,
  dependencies: ['requests'],
  buildStatus: 'pending' as const,
  errorCode: null,
  errorMessage: null,
  errorDetail: null,
  builtAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('manage_sandbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserEntityPermissionsMock.mockResolvedValue('admin')
    hasWorkspaceSandboxAccessMock.mockResolvedValue(true)
    enforceWorkspaceRateLimitMock.mockResolvedValue(null)
    listWorkspaceSandboxesMock.mockResolvedValue([sandbox])
    createWorkspaceSandboxMock.mockResolvedValue({ ok: true, sandbox })
    updateWorkspaceSandboxMock.mockResolvedValue({ ok: true, sandbox })
    deleteWorkspaceSandboxMock.mockResolvedValue({ ok: true, name: sandbox.name })
  })

  it('rejects a missing operation', async () => {
    const result = await executeManageSandbox({}, context)
    expect(result.success).toBe(false)
    expect(result.error).toContain('operation')
  })

  it('ignores a model-supplied workspaceId and uses the server context', async () => {
    await executeManageSandbox({ operation: 'list', workspaceId: 'other-ws' }, context)
    expect(getUserEntityPermissionsMock).toHaveBeenCalledWith('user-1', 'workspace', 'ws-1')
    expect(listWorkspaceSandboxesMock).toHaveBeenCalledWith('ws-1')
  })

  it('lists with only read access, and does not spend the mutation budget', async () => {
    getUserEntityPermissionsMock.mockResolvedValue('read')

    const result = await executeManageSandbox({ operation: 'list' }, context)
    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({ count: 1, strategy: 'prebuilt' })
    const [listed] = (result.output as { sandboxes: Record<string, unknown>[] }).sandboxes
    expect(listed).not.toHaveProperty('errorDetail')
    expect(listed).toMatchObject({ id: 'sb-1', buildStatus: 'pending' })
    expect(enforceWorkspaceRateLimitMock).not.toHaveBeenCalled()
    expect(hasWorkspaceSandboxAccessMock).not.toHaveBeenCalled()
  })

  it.each(['add', 'edit', 'delete'])('requires workspace admin to %s', async (operation) => {
    getUserEntityPermissionsMock.mockResolvedValue('write')

    const result = await executeManageSandbox(
      { operation, name: 'x', language: 'python', sandboxId: 'sb-1' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('Only workspace admins can manage sandboxes')
    expect(createWorkspaceSandboxMock).not.toHaveBeenCalled()
    expect(updateWorkspaceSandboxMock).not.toHaveBeenCalled()
    expect(deleteWorkspaceSandboxMock).not.toHaveBeenCalled()
  })

  it('refuses a write on a workspace without the plan entitlement', async () => {
    hasWorkspaceSandboxAccessMock.mockResolvedValue(false)

    const result = await executeManageSandbox(
      { operation: 'add', name: 'data-tools', language: 'python' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('Sandboxes require an active Max or Enterprise plan.')
    expect(createWorkspaceSandboxMock).not.toHaveBeenCalled()
  })

  it('refuses a write when the workspace mutation budget is exhausted', async () => {
    enforceWorkspaceRateLimitMock.mockResolvedValue({ status: 429 })

    const result = await executeManageSandbox(
      { operation: 'add', name: 'data-tools', language: 'python' },
      context
    )

    expect(enforceWorkspaceRateLimitMock).toHaveBeenCalledWith(
      'sandbox-mutations',
      'ws-1',
      expect.anything()
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('Rate limit exceeded')
    expect(createWorkspaceSandboxMock).not.toHaveBeenCalled()
  })

  it('creates a sandbox', async () => {
    const result = await executeManageSandbox(
      { operation: 'add', name: '  data-tools  ', language: 'Python', dependencies: ['requests'] },
      context
    )

    expect(createWorkspaceSandboxMock).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: 'user-1',
      name: '  data-tools  ',
      language: 'python',
      dependencies: ['requests'],
    })
    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({ sandboxId: 'sb-1' })
  })

  it('rejects an unrecognized language rather than writing it', async () => {
    const result = await executeManageSandbox(
      { operation: 'add', name: 'data-tools', language: 'ruby' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('javascript or python')
    expect(createWorkspaceSandboxMock).not.toHaveBeenCalled()
  })

  it('rejects an edit that changes nothing', async () => {
    const result = await executeManageSandbox({ operation: 'edit', sandboxId: 'sb-1' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('At least one of')
    expect(updateWorkspaceSandboxMock).not.toHaveBeenCalled()
  })

  it('reports a rejected dependency with its line number', async () => {
    updateWorkspaceSandboxMock.mockResolvedValue({
      ok: false,
      failure: {
        code: 'invalid_dependencies',
        message: 'Invalid dependency list',
        issues: [{ line: 2, value: 'not a package!', reason: 'not a valid package name' }],
      },
    })

    const result = await executeManageSandbox(
      { operation: 'edit', sandboxId: 'sb-1', dependencies: ['requests', 'not a package!'] },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('line 2')
    expect(result.error).toContain('not a valid package name')
  })

  it('reports a name conflict', async () => {
    createWorkspaceSandboxMock.mockResolvedValue({
      ok: false,
      failure: { code: 'name_conflict', name: 'data-tools' },
    })

    const result = await executeManageSandbox(
      { operation: 'add', name: 'data-tools', language: 'python' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('already exists')
  })

  it('deletes a sandbox and warns that selecting blocks will fail', async () => {
    const result = await executeManageSandbox({ operation: 'delete', sandboxId: 'sb-1' }, context)

    expect(deleteWorkspaceSandboxMock).toHaveBeenCalledWith('ws-1', 'sb-1')
    expect(result.success).toBe(true)
    expect((result.output as { message: string }).message).toContain('will fail')
  })

  it('reports a delete of an unknown sandbox', async () => {
    deleteWorkspaceSandboxMock.mockResolvedValue({
      ok: false,
      failure: { code: 'not_found', sandboxId: 'sb-9' },
    })

    const result = await executeManageSandbox({ operation: 'delete', sandboxId: 'sb-9' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('sb-9')
  })

  it('forwards a whitespace-only name to the operation, which refuses it', async () => {
    await executeManageSandbox({ operation: 'edit', sandboxId: 'sb-1', name: '   ' }, context)

    expect(updateWorkspaceSandboxMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: '   ' })
    )
  })

  it('rejects a non-string dependency list', async () => {
    const result = await executeManageSandbox(
      { operation: 'add', name: 'data-tools', language: 'python', dependencies: [1, 2] },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('array of strings')
    expect(createWorkspaceSandboxMock).not.toHaveBeenCalled()
  })

  it('surfaces an invalid name refused by the operation', async () => {
    createWorkspaceSandboxMock.mockResolvedValue({
      ok: false,
      failure: { code: 'invalid_name', message: 'Name must be 64 characters or fewer' },
    })

    const result = await executeManageSandbox(
      { operation: 'add', name: 'x'.repeat(65), language: 'python' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('Name must be 64 characters or fewer')
  })

  it('rejects an unsupported operation', async () => {
    const result = await executeManageSandbox({ operation: 'rebuild' }, context)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Unsupported operation')
  })
})
