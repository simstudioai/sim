/**
 * @vitest-environment node
 */

import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { describe, expect, it } from 'vitest'
import { logDelegationPolicy } from '@/lib/logs/application/authorization'
import { logOperations } from '@/lib/logs/application/operations'

const EXECUTOR_PRINCIPAL: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'delegation-1',
  audience: 'sim:logs',
  issuedAt: new Date('2026-08-27T00:00:00.000Z'),
  expiresAt: new Date('2026-08-27T00:05:00.000Z'),
  delegationContext: { kind: 'workflow_execution', workflowId: 'workflow-1' },
  resourceScope: { executionId: 'execution-1' },
}

describe('logs operation registry', () => {
  it('admits executor delegation only to the three semantic read operations it needs', () => {
    expect(logOperations.list.delegatedServices).toEqual(['copilot', 'executor'])
    expect(logOperations.readDetail.delegatedServices).toEqual(['copilot', 'executor'])
    expect(logOperations.readExecutionSnapshot.delegatedServices).toEqual(['executor'])
    expect(logOperations.readStats.delegatedServices).toBeUndefined()

    for (const operation of Object.values(logOperations)) {
      expect(operation.minimumRole).toBe('read')
    }
  })

  it('binds scoped executor reads to the canonical execution context', () => {
    const workspaceContext = {
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
    }

    expect(
      logDelegationPolicy.isWithinScope(EXECUTOR_PRINCIPAL, {
        ...workspaceContext,
        executionId: 'execution-1',
      })
    ).toBe(true)
    expect(
      logDelegationPolicy.isWithinScope(EXECUTOR_PRINCIPAL, {
        ...workspaceContext,
        executionId: 'execution-2',
      })
    ).toBe(false)
  })
})
