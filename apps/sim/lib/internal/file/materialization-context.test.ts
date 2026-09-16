/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@/executor/types'

const { bindDelegation } = vi.hoisted(() => ({ bindDelegation: vi.fn() }))

vi.mock('@/lib/auth/internal-delegation', () => ({
  bindInternalExecutorDelegation: bindDelegation,
}))

import { resolveExecutorFileMaterializationContext } from '@/lib/internal/file/materialization-context'

const workspaceFile = { key: 'workspace/workspace-1/image.png' }
const systemPrincipal = {
  kind: 'system',
  serviceId: 'chat',
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
} as const

function context(): ExecutionContext {
  return {
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    executionId: 'execution-1',
    userId: 'billing-owner',
    principal: systemPrincipal,
    executorDelegationOrigin: {
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      principal: systemPrincipal,
      currentWorkflow: {
        workflowId: 'workflow-1',
        mode: 'deployment',
        deploymentVersionId: 'deployment-1',
      },
    },
    fileKeys: ['execution/workspace-1/workflow-1/prior/image.png'],
  } as ExecutionContext
}

describe('executor file materialization context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bindDelegation.mockResolvedValue({ kind: 'delegated', serviceId: 'executor' })
  })

  it('binds actorless workspace reads to the current deployment without inventing a subject', async () => {
    const ctx = context()
    const result = await resolveExecutorFileMaterializationContext(ctx, workspaceFile)
    expect(bindDelegation).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: systemPrincipal,
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        currentWorkflow: ctx.executorDelegationOrigin?.currentWorkflow,
      }),
      { audience: 'sim:workspace-files', compatibilityActorUserId: 'billing-owner' }
    )
    expect(bindDelegation.mock.calls[0][0].subjectUserId).toBeUndefined()
    expect(result.principal).toEqual({ kind: 'delegated', serviceId: 'executor' })
    expect(result.userId).toBeUndefined()
    expect(result.fileKeys).toBe(ctx.fileKeys)
    expect(ctx.principal).toBe(systemPrincipal)
  })

  it.each([
    { kind: 'session', userId: 'reader', sessionId: 'session-1' },
    { kind: 'personal_api_key', userId: 'reader', keyId: 'key-1' },
    { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-1' },
  ] as const)('preserves the existing $kind workspace authority', async (principal) => {
    const ctx = { ...context(), principal }
    expect((await resolveExecutorFileMaterializationContext(ctx, workspaceFile)).principal).toBe(
      principal
    )
    expect(bindDelegation).not.toHaveBeenCalled()
  })

  it.each([
    'execution/workspace-1/workflow-1/execution-1/image.png',
    'knowledge-base/document.png',
    'url/https://example.com/image.png',
    '',
    'provider-file-id',
    'profile-pictures/avatar.png',
  ])('does not replace the original identity for %s', async (key) => {
    const ctx = context()
    expect((await resolveExecutorFileMaterializationContext(ctx, { key })).principal).toBe(
      systemPrincipal
    )
    expect(bindDelegation).not.toHaveBeenCalled()
  })

  it('fails closed without a trusted executor origin', async () => {
    const ctx = context()
    ctx.executorDelegationOrigin = undefined
    await expect(resolveExecutorFileMaterializationContext(ctx, workspaceFile)).rejects.toThrow()
    expect(bindDelegation).not.toHaveBeenCalled()
  })

  it('propagates a failed current workflow binding without an owner fallback', async () => {
    bindDelegation.mockRejectedValueOnce(new Error('Workflow binding invalid'))
    await expect(
      resolveExecutorFileMaterializationContext(context(), workspaceFile)
    ).rejects.toThrow('Workflow binding invalid')
    expect(bindDelegation).toHaveBeenCalledTimes(1)
  })
})
