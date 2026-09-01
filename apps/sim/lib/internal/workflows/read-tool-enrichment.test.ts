/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestRuntimePrincipal } from '@/lib/auth/runtime-principal.test-support'

const { mockReadWorkflowDefinitionAsExecutor } = vi.hoisted(() => ({
  mockReadWorkflowDefinitionAsExecutor: vi.fn(),
}))

vi.mock('@/lib/internal/workflows/read-definition', () => ({
  readWorkflowDefinitionAsExecutor: mockReadWorkflowDefinitionAsExecutor,
}))

import {
  readWorkflowInputFieldsForTool,
  readWorkflowMetadataForTool,
} from '@/lib/internal/workflows/read-tool-enrichment'

describe('workflow tool enrichment authority', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('derives target draft authority from the verified human execution principal', async () => {
    mockReadWorkflowDefinitionAsExecutor.mockResolvedValue({
      workflow: { name: 'Child workflow', description: 'Runs the child' },
      state: { blocks: {} },
    })
    const principal = createTestRuntimePrincipal({
      principal: { kind: 'session', userId: 'actual-user', sessionId: 'session-1' },
      executionId: 'execution-1',
      rootWorkflowId: 'parent-workflow',
    })

    await expect(
      readWorkflowMetadataForTool('child-workflow', {
        userId: 'billing-owner',
        workflowId: 'parent-workflow',
        executionId: 'execution-1',
        principal,
      })
    ).resolves.toEqual({ name: 'Child workflow', description: 'Runs the child' })

    expect(mockReadWorkflowDefinitionAsExecutor).toHaveBeenCalledWith({
      principal,
      workflowId: 'child-workflow',
      state: 'draft',
    })
  })

  it('preserves deployed authority instead of reinterpreting a compatibility user as actor', async () => {
    mockReadWorkflowDefinitionAsExecutor.mockResolvedValue({
      workflow: { name: 'Child workflow', description: null },
      state: { blocks: {} },
    })
    const currentWorkflow = {
      workflowId: 'parent-workflow',
      mode: 'deployment' as const,
      deploymentVersionId: 'deployment-1',
    }
    const principal = createTestRuntimePrincipal({
      principal: {
        kind: 'system',
        serviceId: 'schedule',
        workspaceId: 'workspace-1',
        workflowId: 'parent-workflow',
      },
      executionId: 'execution-1',
      rootWorkflowId: 'parent-workflow',
      currentWorkflow,
    })

    await expect(
      readWorkflowInputFieldsForTool('child-workflow', {
        userId: 'billing-owner',
        workflowId: 'parent-workflow',
        executionId: 'execution-1',
        principal,
      })
    ).resolves.toEqual([])

    expect(mockReadWorkflowDefinitionAsExecutor).toHaveBeenCalledWith({
      principal,
      workflowId: 'child-workflow',
      state: 'deployed',
    })
  })

  it('rejects actorless draft enrichment', async () => {
    await expect(
      readWorkflowMetadataForTool('child-workflow', {
        userId: 'billing-owner',
        workflowId: 'parent-workflow',
        principal: createTestRuntimePrincipal({
          principal: {
            kind: 'system',
            serviceId: 'internal',
            workspaceId: 'workspace-1',
            workflowId: 'parent-workflow',
          },
          rootWorkflowId: 'parent-workflow',
        }),
      })
    ).rejects.toThrow('Actorless workflow enrichment requires deployed execution authority')

    expect(mockReadWorkflowDefinitionAsExecutor).not.toHaveBeenCalled()
  })

  it('fails closed when execution authority is absent', async () => {
    await expect(
      readWorkflowMetadataForTool('child-workflow', {
        userId: 'billing-owner',
        workflowId: 'parent-workflow',
      })
    ).rejects.toThrow('Workflow enrichment requires trusted execution authority')

    expect(mockReadWorkflowDefinitionAsExecutor).not.toHaveBeenCalled()
  })
})
