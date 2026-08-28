/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'
import { rebindWorkspaceFileDelegatedPrincipal } from '@/lib/workspace-files/application/delegated-principal'

describe('rebindWorkspaceFileDelegatedPrincipal', () => {
  it('preserves actorless workflow identity and deployment authority', () => {
    const delegationContext = {
      kind: 'workflow_execution' as const,
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      principal: {
        kind: 'system' as const,
        serviceId: 'schedule' as const,
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
      },
      currentWorkflow: {
        workflowId: 'workflow-1',
        mode: 'deployment' as const,
        deploymentVersionId: 'deployment-1',
      },
    }

    const rebound = rebindWorkspaceFileDelegatedPrincipal({
      principal: {
        kind: 'delegated',
        serviceId: 'executor',
        workspaceId: 'workspace-1',
        delegationId: 'function-1',
        audience: 'sim:function-executions',
        issuedAt: new Date(Date.now() - 1_000),
        expiresAt: new Date(Date.now() + 60_000),
        delegationContext,
      },
      workspaceId: 'workspace-1',
      delegationId: 'file-1',
      executionId: 'execution-1',
    })

    expect(rebound).toMatchObject({
      serviceId: 'executor',
      workspaceId: 'workspace-1',
      delegationId: 'file-1',
      audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
      resourceScope: { executionId: 'execution-1' },
      delegationContext,
    })
    expect(rebound).not.toHaveProperty('subjectUserId')
  })

  it('rejects a cross-workspace rebind', () => {
    expect(() =>
      rebindWorkspaceFileDelegatedPrincipal({
        principal: {
          kind: 'delegated',
          serviceId: 'copilot',
          subjectUserId: 'user-1',
          workspaceId: 'workspace-1',
          delegationId: 'copilot-1',
          audience: 'sim:function-executions',
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        },
        workspaceId: 'workspace-2',
        delegationId: 'file-1',
      })
    ).toThrow('Workspace file delegation does not match its authorized workspace')
  })
})
