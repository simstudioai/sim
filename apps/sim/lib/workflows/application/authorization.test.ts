/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { createTestRuntimePrincipal } from '@/lib/auth/runtime-principal.test-support'
import {
  requireWorkflowExecutionUserId,
  WORKFLOW_DELEGATION_AUDIENCE,
  workflowDelegationPolicy,
} from '@/lib/workflows/application/authorization'
import { workflowOperations } from '@/lib/workflows/application/operations'

function createCopilotPrincipal() {
  return {
    kind: 'delegated' as const,
    serviceId: 'copilot' as const,
    subjectUserId: 'user-1',
    workspaceId: 'workspace-1',
    delegationId: 'execution-1',
    audience: WORKFLOW_DELEGATION_AUDIENCE,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  }
}

describe('workflow delegation policy', () => {
  it('allows an active execution to read a different workflow in the same workspace', () => {
    const principal = createCopilotPrincipal()

    expect(
      workflowDelegationPolicy.isWithinScope(principal, {
        workspaceId: 'workspace-1',
        workspaceOrganizationId: null,
        allowPersonalApiKeys: true,
        billedAccountUserId: 'user-1',
        workflowId: 'child-workflow',
      })
    ).toBe(true)
  })

  it('rejects a child workflow in another workspace', () => {
    const principal = createCopilotPrincipal()

    expect(
      workflowDelegationPolicy.isWithinScope(principal, {
        workspaceId: 'workspace-2',
        workspaceOrganizationId: null,
        allowPersonalApiKeys: true,
        billedAccountUserId: 'user-2',
        workflowId: 'child-workflow',
      })
    ).toBe(false)
  })

  it('permits workflow execution only on declared workflow operations', () => {
    expect(workflowOperations.read.workflowExecution).toBe('allow')
    expect(workflowOperations.update.workflowExecution).toBeUndefined()
    expect(workflowOperations.delete.workflowExecution).toBeUndefined()
  })
})

describe('workflow execution actor', () => {
  it('uses the legacy execution actor when the principal is actorless', () => {
    const principal = createTestRuntimePrincipal({
      principal: {
        kind: 'system',
        serviceId: 'schedule',
        workspaceId: 'workspace-1',
        workflowId: 'parent-workflow',
      },
      rootWorkflowId: 'parent-workflow',
      currentWorkflow: {
        workflowId: 'parent-workflow',
        mode: 'deployment',
        deploymentVersionId: 'deployment-1',
      },
      compatibilityActorUserId: 'execution-actor',
    })

    expect(requireWorkflowExecutionUserId(principal)).toBe('execution-actor')
  })

  it('prefers a real principal subject over the compatibility actor', () => {
    const principal = createTestRuntimePrincipal({
      currentWorkflow: {
        workflowId: 'workflow-1',
        mode: 'deployment',
        deploymentVersionId: 'deployment-1',
      },
    })

    expect(requireWorkflowExecutionUserId(principal)).toBe('user-1')
  })
})
