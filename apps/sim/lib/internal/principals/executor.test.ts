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
      ...(claims.subjectUserId ? { subjectUserId: claims.subjectUserId } : {}),
      workspaceId: 'workspace-canonical',
      delegationId: claims.delegationId,
      audience: options.audience,
      issuedAt: claims.issuedAt,
      expiresAt: claims.expiresAt,
      resourceScope: options.resourceScope,
      delegationContext: {
        kind: 'workflow_execution',
        workflowId: claims.workflowId,
        ...(claims.executionId ? { executionId: claims.executionId } : {}),
        ...(claims.principal ? { principal: claims.principal } : {}),
        ...(claims.currentWorkflow ? { currentWorkflow: claims.currentWorkflow } : {}),
        ...(options.compatibilityActorUserId
          ? {
              compatibilityActor: {
                kind: 'legacy_execution_user' as const,
                userId: options.compatibilityActorUserId,
              },
            }
          : {}),
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
      {
        audience: 'sim:tables',
        resourceScope: { tableId: 'table-1' },
      }
    )
  })

  it('uses an explicit trusted execution deadline as the delegation expiry', async () => {
    const expiresAt = new Date('2026-01-01T01:00:00.000Z')

    await createExecutorPrincipalFromExecutionContext({
      context: executionContext({
        executorDelegationOrigin: {
          subjectUserId: 'user-origin',
          workflowId: 'workflow-origin',
          executionId: 'execution-origin',
        },
      }),
      audience: 'sim:function-executions',
      expiresAt,
    })

    expect(mockBindInternalExecutorDelegation).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt }),
      { audience: 'sim:function-executions' }
    )
  })

  it.each([
    {
      name: 'schedule',
      principal: {
        kind: 'system' as const,
        serviceId: 'schedule' as const,
        workspaceId: 'workspace-canonical',
        workflowId: 'workflow-origin',
      },
    },
    {
      name: 'workspace API key',
      principal: {
        kind: 'workspace_api_key' as const,
        workspaceId: 'workspace-canonical',
        keyId: 'workspace-key-1',
      },
    },
    {
      name: 'webhook external subject',
      principal: {
        kind: 'system' as const,
        serviceId: 'webhook' as const,
        workspaceId: 'workspace-canonical',
        workflowId: 'workflow-origin',
        webhookId: 'webhook-1',
        provider: 'slack',
        subject: {
          kind: 'external_user' as const,
          provider: 'slack',
          tenantId: 'team-1',
          subjectId: 'external-user-1',
        },
      },
    },
  ])('preserves an actorless $name principal and deployment authority', async ({ principal }) => {
    const currentWorkflow = {
      workflowId: 'workflow-origin',
      mode: 'deployment' as const,
      deploymentVersionId: 'deployment-1',
    }

    await createExecutorPrincipalFromExecutionContext({
      context: executionContext({
        executorDelegationOrigin: {
          workflowId: 'workflow-origin',
          executionId: 'execution-origin',
          principal,
          currentWorkflow,
        },
      }),
      audience: 'sim:tables',
    })

    expect(mockBindInternalExecutorDelegation).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-origin',
        executionId: 'execution-origin',
        principal,
        currentWorkflow,
      }),
      { audience: 'sim:tables', compatibilityActorUserId: 'user-current' }
    )
    expect(mockBindInternalExecutorDelegation.mock.calls[0]?.[0]).not.toHaveProperty(
      'subjectUserId'
    )
  })

  it('derives the subject from the preserved human principal', async () => {
    const principal = {
      kind: 'session' as const,
      userId: 'user-origin',
      sessionId: 'session-origin',
    }

    await createExecutorPrincipalFromExecutionContext({
      context: executionContext({
        executorDelegationOrigin: {
          workflowId: 'workflow-origin',
          executionId: 'execution-origin',
          principal,
          currentWorkflow: { workflowId: 'workflow-origin', mode: 'draft' },
        },
      }),
      audience: 'sim:tables',
    })

    expect(mockBindInternalExecutorDelegation).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectUserId: 'user-origin',
        principal,
        currentWorkflow: { workflowId: 'workflow-origin', mode: 'draft' },
      }),
      { audience: 'sim:tables' }
    )
  })

  it('rejects a supplied subject that disagrees with the preserved principal', async () => {
    await expect(
      createExecutorPrincipalFromExecutionContext({
        context: executionContext({
          executorDelegationOrigin: {
            subjectUserId: 'forged-user',
            workflowId: 'workflow-origin',
            principal: {
              kind: 'session',
              userId: 'user-origin',
              sessionId: 'session-origin',
            },
          },
        }),
        audience: 'sim:tables',
      })
    ).rejects.toThrow('Executor subject does not match its workflow principal')
    expect(mockBindInternalExecutorDelegation).not.toHaveBeenCalled()
  })

  it('fails closed without a canonical delegation origin', async () => {
    await expect(
      createExecutorPrincipalFromExecutionContext({
        context: executionContext(),
        audience: 'sim:tables',
      })
    ).rejects.toThrow('Executor delegation origin is required')
    expect(mockBindInternalExecutorDelegation).not.toHaveBeenCalled()
  })
})
