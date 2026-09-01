/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestRuntimePrincipal } from '@/lib/auth/runtime-principal.test-support'

const { mockBindRuntimeExecution, mockReadWorkflowDefinition } = vi.hoisted(() => ({
  mockBindRuntimeExecution: vi.fn(),
  mockReadWorkflowDefinition: vi.fn(),
}))

vi.mock('@/lib/auth/internal-delegation', () => ({
  bindRuntimeWorkflowExecution: mockBindRuntimeExecution,
}))

vi.mock('@/lib/workflows/application/read-workflow-definition', () => ({
  readWorkflowDefinition: { execute: mockReadWorkflowDefinition },
}))

import { readWorkflowDefinitionAsExecutor } from '@/lib/internal/workflows/read-definition'

describe('readWorkflowDefinitionAsExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('revalidates the trusted runtime principal before reading the child', async () => {
    const principal = createTestRuntimePrincipal({
      executionId: 'execution-1',
      rootWorkflowId: 'parent-workflow',
    })
    const definition = { workflow: { id: 'child-workflow' }, state: { blocks: {} } }
    mockBindRuntimeExecution.mockResolvedValue({ principal, workspaceId: 'workspace-1' })
    mockReadWorkflowDefinition.mockResolvedValue(definition)

    const result = await readWorkflowDefinitionAsExecutor({
      principal,
      workflowId: 'child-workflow',
      state: 'deployed',
    })

    expect(result).toBe(definition)
    expect(mockBindRuntimeExecution).toHaveBeenCalledWith(principal)
    expect(mockReadWorkflowDefinition).toHaveBeenCalledWith({
      principal,
      input: {
        workflowId: 'child-workflow',
        state: 'deployed',
        assertedWorkspaceId: 'workspace-1',
      },
    })
  })

  it('preserves an actorless principal and current workflow authority', async () => {
    const principal = createTestRuntimePrincipal({
      principal: {
        kind: 'system',
        serviceId: 'internal',
        workspaceId: 'workspace-1',
        workflowId: 'parent-workflow',
      },
      executionId: 'execution-1',
      rootWorkflowId: 'parent-workflow',
    })
    mockBindRuntimeExecution.mockResolvedValue({ principal, workspaceId: 'workspace-1' })
    mockReadWorkflowDefinition.mockResolvedValue({ workflow: {}, state: null })

    await readWorkflowDefinitionAsExecutor({
      principal,
      workflowId: 'child-workflow',
      state: 'draft',
    })

    expect(mockBindRuntimeExecution).toHaveBeenCalledWith(principal)
    expect(mockReadWorkflowDefinition).toHaveBeenCalledWith({
      principal,
      input: {
        workflowId: 'child-workflow',
        state: 'draft',
        assertedWorkspaceId: 'workspace-1',
      },
    })
  })

  it('propagates canonical principal binding failures', async () => {
    const principal = createTestRuntimePrincipal({ rootWorkflowId: 'parent-workflow' })
    mockBindRuntimeExecution.mockRejectedValue(new Error('Execution principal is noncanonical'))

    await expect(
      readWorkflowDefinitionAsExecutor({
        principal,
        workflowId: 'child-workflow',
        state: 'draft',
      })
    ).rejects.toThrow('Execution principal is noncanonical')

    expect(mockBindRuntimeExecution).toHaveBeenCalledWith(principal)
    expect(mockReadWorkflowDefinition).not.toHaveBeenCalled()
  })
})
