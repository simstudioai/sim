/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@/executor/types'

const { mockBindInternalExecutorDelegation } = vi.hoisted(() => ({
  mockBindInternalExecutorDelegation: vi.fn(),
}))

vi.mock('@/lib/auth/internal-delegation', () => ({
  bindInternalExecutorDelegation: mockBindInternalExecutorDelegation,
}))

import { createExecutorPrincipalFromExecutionContext } from '@/lib/internal/principals/executor'

function executionContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    workflowId: 'workflow-current',
    executionId: 'execution-current',
    userId: 'user-current',
    ...overrides,
  } as ExecutionContext
}

describe('createExecutorPrincipalFromExecutionContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBindInternalExecutorDelegation.mockImplementation(async (claims, options) => ({
      kind: 'delegated',
      serviceId: 'executor',
      subjectUserId: claims.subjectUserId,
      workspaceId: 'workspace-canonical',
      delegationId: claims.delegationId,
      audience: options.audience,
      issuedAt: claims.issuedAt,
      expiresAt: claims.expiresAt,
      resourceScope: options.resourceScope,
      delegationContext: {
        kind: 'workflow_execution',
        workflowId: claims.workflowId,
        executionId: claims.executionId,
      },
    }))
  })

  it('uses the signed delegation origin ahead of nested execution identity', async () => {
    await createExecutorPrincipalFromExecutionContext({
      context: executionContext({
        executorDelegationOrigin: {
          subjectUserId: 'user-origin',
          workflowId: 'workflow-origin',
          executionId: 'execution-origin',
        },
      }),
      audience: 'sim:tables',
      resourceScope: { tableId: 'table-1' },
    })

    expect(mockBindInternalExecutorDelegation).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectUserId: 'user-origin',
        workflowId: 'workflow-origin',
        executionId: 'execution-origin',
      }),
      { audience: 'sim:tables', resourceScope: { tableId: 'table-1' } }
    )
  })

  it('falls back to the current trusted execution identity when no origin is present', async () => {
    await createExecutorPrincipalFromExecutionContext({
      context: executionContext(),
      audience: 'sim:tables',
    })

    expect(mockBindInternalExecutorDelegation).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectUserId: 'user-current',
        workflowId: 'workflow-current',
        executionId: 'execution-current',
      }),
      { audience: 'sim:tables' }
    )
  })

  it('fails closed without an acting user in either trusted identity source', async () => {
    await expect(
      createExecutorPrincipalFromExecutionContext({
        context: executionContext({ userId: undefined }),
        audience: 'sim:tables',
      })
    ).rejects.toThrow('Authentication required')
    expect(mockBindInternalExecutorDelegation).not.toHaveBeenCalled()
  })
})
