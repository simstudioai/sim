/**
 * @vitest-environment node
 */

import type { DelegatedPrincipal } from '@sim/auth/principal'
import { describe, expect, it } from 'vitest'
import {
  requireWorkflowExecutionUserId,
  WORKFLOW_DELEGATION_AUDIENCE,
  workflowDelegationPolicy,
} from '@/lib/workflows/application/authorization'
import { workflowOperations } from '@/lib/workflows/application/operations'

function createExecutorPrincipal(overrides: Partial<DelegatedPrincipal> = {}): DelegatedPrincipal {
  return {
    kind: 'delegated',
    serviceId: 'executor',
    subjectUserId: 'user-1',
    workspaceId: 'workspace-1',
    delegationId: 'execution-1',
    audience: WORKFLOW_DELEGATION_AUDIENCE,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    delegationContext: { kind: 'workflow_execution', workflowId: 'parent-workflow' },
    ...overrides,
  }
}

describe('workflow delegation policy', () => {
  it('allows an active execution to read a different workflow in the same workspace', () => {
    const principal = createExecutorPrincipal()

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
    const principal = createExecutorPrincipal()

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

  it('rejects executor delegation without a canonical workflow execution origin', () => {
    const principal = createExecutorPrincipal({ delegationContext: undefined })

    expect(
      workflowDelegationPolicy.isWithinScope(principal, {
        workspaceId: 'workspace-1',
        workspaceOrganizationId: null,
        allowPersonalApiKeys: true,
        billedAccountUserId: 'user-1',
        workflowId: 'child-workflow',
      })
    ).toBe(false)
  })

  it('permits executor delegation only on workflow reads', () => {
    expect(workflowOperations.read.delegatedServices).toContain('executor')
    expect(workflowOperations.update.delegatedServices).not.toContain('executor')
    expect(workflowOperations.delete.delegatedServices).not.toContain('executor')
  })
})

describe('workflow execution actor', () => {
  it('uses the legacy execution actor when the principal is actorless', () => {
    const principal = createExecutorPrincipal({ subjectUserId: undefined })

    expect(requireWorkflowExecutionUserId(principal, 'execution-actor')).toBe('execution-actor')
  })

  it('prefers a real principal subject over the compatibility actor', () => {
    expect(requireWorkflowExecutionUserId(createExecutorPrincipal(), 'someone-else')).toBe('user-1')
  })
})
