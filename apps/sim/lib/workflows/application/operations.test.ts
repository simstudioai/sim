import { permissionSatisfies } from '@sim/platform-authz/workspace'
import { describe, expect, it } from 'vitest'
import { workflowOperations } from '@/lib/workflows/application/operations'

describe('workflow operation registry', () => {
  it('keeps every workspace-key operation consistent and at or below the write ceiling', () => {
    for (const operation of Object.values(workflowOperations)) {
      expect(
        operation.principalKinds.includes('workspace_api_key'),
        `${operation.id} has inconsistent workspace API-key declarations`
      ).toBe(operation.workspaceApiKey === 'allow')

      if (operation.workspaceApiKey === 'allow') {
        expect(
          permissionSatisfies('write', operation.minimumRole),
          `${operation.id} exceeds the workspace API-key write ceiling`
        ).toBe(true)
      }
    }
  })

  it('admits executor delegation only to workflow deployment operations', () => {
    for (const operation of [
      workflowOperations.deploy,
      workflowOperations.undeploy,
      workflowOperations.activateVersion,
    ]) {
      expect(operation).toMatchObject({
        minimumRole: 'admin',
        workspaceApiKey: 'deny',
        principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
        delegatedServices: ['copilot', 'executor'],
      })
    }

    for (const operation of [workflowOperations.listVersions, workflowOperations.readVersion]) {
      expect(operation).toMatchObject({
        minimumRole: 'read',
        workspaceApiKey: 'allow',
        principalKinds: [
          'session',
          'personal_api_key',
          'oauth_access_token',
          'workspace_api_key',
          'delegated',
        ],
        delegatedServices: ['copilot', 'executor'],
      })
    }

    expect(workflowOperations.deployChat.delegatedServices).toEqual(['copilot'])
    expect(workflowOperations.undeployChat.delegatedServices).toEqual(['copilot'])
    expect(workflowOperations.revertVersion.delegatedServices).toEqual(['copilot'])
  })

  /**
   * Toggling unauthenticated public execution removes the authentication
   * requirement from a deployed workflow, so it takes an accountable human:
   * admin role and no workspace key. Copilot uses the actual user's admin role.
   */
  it('reserves public-execution changes for an accountable human admin', () => {
    expect(workflowOperations.updatePublicApi).toMatchObject({
      id: 'workflows.public_api.update',
      minimumRole: 'admin',
      workspaceApiKey: 'deny',
      principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
    })
    expect(workflowOperations.updatePublicApi.principalKinds).not.toContain('workspace_api_key')
    expect(workflowOperations.updatePublicApi.delegatedServices).toEqual(['copilot'])
  })

  /**
   * `workflows.operations.apply` stays denied to workspace API keys: the three
   * permission lookups it performs need a human subject, and both substitutes
   * for an actorless key fail *open* — attributing to the workspace billing
   * owner evaluates the batch as the least-restricted account, and passing no
   * user makes `getUserPermissionConfig` return `null`, which every caller
   * reads as unrestricted. Re-open it only once those lookups fail closed.
   */
  it('keeps workflow edit batches denied to actorless workspace keys', () => {
    expect(workflowOperations.applyOperations).toMatchObject({
      id: 'workflows.operations.apply',
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
      delegatedServices: ['copilot'],
    })
    expect(workflowOperations.applyOperations.principalKinds).not.toContain('workspace_api_key')
  })
})
