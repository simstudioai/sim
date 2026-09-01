/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'
import { rebindWorkspaceFileDelegatedPrincipal } from '@/lib/workspace-files/application/delegated-principal'

describe('rebindWorkspaceFileDelegatedPrincipal', () => {
  it('preserves the delegated actor identity', () => {
    const expiresAt = new Date(Date.now() + 60_000)

    const rebound = rebindWorkspaceFileDelegatedPrincipal({
      principal: {
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'user-1',
        workspaceId: 'workspace-1',
        delegationId: 'function-1',
        audience: 'sim:function-executions',
        issuedAt: new Date(Date.now() - 1_000),
        expiresAt,
      },
      workspaceId: 'workspace-1',
      delegationId: 'file-1',
      executionId: 'execution-1',
    })

    expect(rebound).toMatchObject({
      serviceId: 'copilot',
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
      delegationId: 'file-1',
      audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
      resourceScope: { executionId: 'execution-1' },
    })
    expect(rebound.expiresAt).toEqual(expiresAt)
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
