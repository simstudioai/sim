/**
 * @vitest-environment node
 */

import { permissionSatisfies } from '@sim/platform-authz/workspace'
import { describe, expect, it } from 'vitest'
import { workflowOperations } from '@/lib/workflows/application/operations'

describe('workflow operation registry', () => {
  it('uses unique stable operation IDs', () => {
    const ids = Object.values(workflowOperations).map((operation) => operation.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

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

  /**
   * Headless variable editing was widened to workspace API keys when the v2
   * surface shipped. It is a plain `write` on workflow-scoped data, so the key's
   * write ceiling is the whole policy — a role increase here would silently make
   * the declaration self-contradictory rather than fail.
   */
  it('opens variable edits to every workflow principal at the write role', () => {
    expect(workflowOperations.applyVariableOperations).toMatchObject({
      id: 'workflows.variables.apply_operations',
      minimumRole: 'write',
      workspaceApiKey: 'allow',
      principalKinds: [
        'session',
        'personal_api_key',
        'oauth_access_token',
        'workspace_api_key',
        'delegated',
      ],
      delegatedServices: ['copilot'],
    })
    expect(Object.isFrozen(workflowOperations.applyVariableOperations)).toBe(true)
  })

  it('opens bulk moves to every workflow principal at the write role', () => {
    expect(workflowOperations.moveBulk).toMatchObject({
      id: 'workflows.bulk.move',
      minimumRole: 'write',
      workspaceApiKey: 'allow',
      principalKinds: [
        'session',
        'personal_api_key',
        'oauth_access_token',
        'workspace_api_key',
        'delegated',
      ],
      delegatedServices: ['copilot'],
    })
    expect(Object.isFrozen(workflowOperations.moveBulk)).toBe(true)
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
   * admin role, no workspace key, and — unlike every other admin write in this
   * registry — no Copilot delegation.
   */
  it('reserves public-execution changes for an accountable human admin', () => {
    expect(workflowOperations.updatePublicApi).toMatchObject({
      id: 'workflows.public_api.update',
      minimumRole: 'admin',
      workspaceApiKey: 'deny',
      principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    })
    expect(workflowOperations.updatePublicApi.principalKinds).not.toContain('workspace_api_key')
    expect(workflowOperations.updatePublicApi.principalKinds).not.toContain('delegated')
    expect(workflowOperations.updatePublicApi.delegatedServices).toBeUndefined()
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

  it('reserves manual execution for personal keys with write access', () => {
    for (const operation of [
      workflowOperations.executeManual,
      workflowOperations.executeManualFromBlock,
    ]) {
      expect(operation).toMatchObject({
        minimumRole: 'write',
        workspaceApiKey: 'deny',
        principalKinds: ['personal_api_key', 'oauth_access_token'],
      })
      expect(operation.id).toMatch(/^workflows\.manual\.execute/)
    }
  })

  it('protects paused execution detail as a workflow read', () => {
    expect(workflowOperations.readPausedExecution).toMatchObject({
      id: 'workflows.paused_executions.read',
      minimumRole: 'read',
      workspaceApiKey: 'allow',
      principalKinds: [
        'session',
        'personal_api_key',
        'oauth_access_token',
        'workspace_api_key',
        'delegated',
      ],
      delegatedServices: ['copilot'],
    })
  })
})
