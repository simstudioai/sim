/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBindInternalExecutorDelegation, mockReadWorkflowDefinition } = vi.hoisted(() => ({
  mockBindInternalExecutorDelegation: vi.fn(),
  mockReadWorkflowDefinition: vi.fn(),
}))

vi.mock('@/lib/auth/internal-delegation', () => ({
  bindInternalExecutorDelegation: mockBindInternalExecutorDelegation,
}))

vi.mock('@/lib/workflows/application/read-workflow-definition', () => ({
  readWorkflowDefinition: { execute: mockReadWorkflowDefinition },
}))

import { readWorkflowDefinitionAsExecutor } from '@/lib/internal/workflows/read-definition'
import { WORKFLOW_DELEGATION_AUDIENCE } from '@/lib/workflows/application/authorization'

describe('readWorkflowDefinitionAsExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('binds the trusted workflow execution origin before reading the child', async () => {
    const principal = {
      kind: 'delegated',
      serviceId: 'executor',
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
      delegationId: 'delegation-1',
      audience: WORKFLOW_DELEGATION_AUDIENCE,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      delegationContext: {
        kind: 'workflow_execution',
        workflowId: 'parent-workflow',
        executionId: 'execution-1',
      },
    }
    const definition = { workflow: { id: 'child-workflow' }, state: { blocks: {} } }
    mockBindInternalExecutorDelegation.mockResolvedValue(principal)
    mockReadWorkflowDefinition.mockResolvedValue(definition)

    const result = await readWorkflowDefinitionAsExecutor({
      origin: {
        subjectUserId: 'user-1',
        workflowId: 'parent-workflow',
        executionId: 'execution-1',
      },
      workflowId: 'child-workflow',
      state: 'deployed',
    })

    expect(result).toBe(definition)
    expect(mockBindInternalExecutorDelegation).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceId: 'executor',
        subjectUserId: 'user-1',
        workflowId: 'parent-workflow',
        executionId: 'execution-1',
        delegationId: expect.any(String),
        issuedAt: expect.any(Date),
        expiresAt: expect.any(Date),
      }),
      { audience: WORKFLOW_DELEGATION_AUDIENCE }
    )
    expect(mockReadWorkflowDefinition).toHaveBeenCalledWith({
      principal,
      input: { workflowId: 'child-workflow', state: 'deployed' },
    })
  })

  it('preserves an actorless principal and current workflow authority', async () => {
    const sourcePrincipal = {
      kind: 'system' as const,
      serviceId: 'internal' as const,
      workspaceId: 'workspace-1',
      workflowId: 'parent-workflow',
    }
    const delegatedPrincipal = {
      kind: 'delegated' as const,
      serviceId: 'executor' as const,
      workspaceId: 'workspace-1',
      delegationId: 'delegation-1',
      audience: WORKFLOW_DELEGATION_AUDIENCE,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      delegationContext: {
        kind: 'workflow_execution' as const,
        workflowId: 'parent-workflow',
        executionId: 'execution-1',
        principal: sourcePrincipal,
        currentWorkflow: {
          workflowId: 'parent-workflow',
          mode: 'draft' as const,
        },
      },
    }
    mockBindInternalExecutorDelegation.mockResolvedValue(delegatedPrincipal)
    mockReadWorkflowDefinition.mockResolvedValue({ workflow: {}, state: null })

    await readWorkflowDefinitionAsExecutor({
      origin: {
        workflowId: 'parent-workflow',
        executionId: 'execution-1',
        principal: sourcePrincipal,
        currentWorkflow: { workflowId: 'parent-workflow', mode: 'draft' },
      },
      workflowId: 'child-workflow',
      state: 'draft',
    })

    expect(mockBindInternalExecutorDelegation).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceId: 'executor',
        workflowId: 'parent-workflow',
        executionId: 'execution-1',
        principal: sourcePrincipal,
        currentWorkflow: { workflowId: 'parent-workflow', mode: 'draft' },
      }),
      { audience: WORKFLOW_DELEGATION_AUDIENCE }
    )
    expect(mockBindInternalExecutorDelegation.mock.calls[0][0]).not.toHaveProperty('subjectUserId')
    expect(mockReadWorkflowDefinition).toHaveBeenCalledWith({
      principal: delegatedPrincipal,
      input: { workflowId: 'child-workflow', state: 'draft' },
    })
  })

  it('rejects a subject that conflicts with the preserved workflow principal', async () => {
    await expect(
      readWorkflowDefinitionAsExecutor({
        origin: {
          subjectUserId: 'user-2',
          workflowId: 'parent-workflow',
          principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        },
        workflowId: 'child-workflow',
        state: 'draft',
      })
    ).rejects.toThrow('Executor subject does not match its workflow principal')

    expect(mockBindInternalExecutorDelegation).not.toHaveBeenCalled()
    expect(mockReadWorkflowDefinition).not.toHaveBeenCalled()
  })
})
