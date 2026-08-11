/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { apiKeyOperations } from '@/lib/api-key/application/operations'
import { mcpServerOperations } from '@/lib/mcp/application/operations'
import { workflowOperations } from '@/lib/workflows/application/operations'

/**
 * The deployment permission matrix, asserted in one place.
 *
 * `minimumRole` is declarative data, so a single-character edit silently widens
 * or narrows access with no failing test — the surrounding suites assert which
 * operation a handler invoked, not what role that operation demands. This pins
 * the boundary that matters: deploying a workflow needs `write`, while minting a
 * workspace API key (a credential that can invoke every deployed workflow in the
 * workspace) and installing a custom block (code that runs in every workflow)
 * stay `admin`.
 */
describe('deployment permission matrix', () => {
  describe('deployment lifecycle requires write', () => {
    it.each([
      ['deploy', workflowOperations.deploy],
      ['undeploy', workflowOperations.undeploy],
      ['deployChat', workflowOperations.deployChat],
      ['undeployChat', workflowOperations.undeployChat],
      ['updatePublicApi', workflowOperations.updatePublicApi],
      ['activateVersion', workflowOperations.activateVersion],
      ['revertVersion', workflowOperations.revertVersion],
      ['updateVersion', workflowOperations.updateVersion],
    ])('workflowOperations.%s', (_name, operation) => {
      expect(operation.minimumRole).toBe('write')
    })

    it.each([
      ['createWorkflowServer', mcpServerOperations.createWorkflowDeploymentServer],
      ['updateWorkflowServer', mcpServerOperations.updateWorkflowDeploymentServer],
      ['deleteWorkflowServer', mcpServerOperations.deleteWorkflowDeploymentServer],
      ['deployTool', mcpServerOperations.deployWorkflowTool],
      ['undeployTool', mcpServerOperations.undeployWorkflowTool],
    ])('mcpServerOperations.%s', (_name, operation) => {
      expect(operation.minimumRole).toBe('write')
    })
  })

  describe('credential and code-injection surfaces stay admin', () => {
    it('minting a workspace API key requires admin', () => {
      expect(apiKeyOperations.createFromCopilot.minimumRole).toBe('admin')
    })

    it('workflow policy (lock) requires admin', () => {
      expect(workflowOperations.updatePolicy.minimumRole).toBe('admin')
    })
  })

  /**
   * Scope note: this asserts the operation *declarations*, which govern every
   * surface routed through the operation registry. The v1 REST API
   * (`resolveV1DeploymentWorkflow`) predates the registry and runs its own
   * `validateWorkspaceAccess`, resolving a workspace key to its creator — so a
   * workspace key can still deploy there. That gap is pre-existing and tracked
   * separately; do not read these assertions as covering v1.
   */
  describe('deployment operations reject workspace API keys', () => {
    it.each([
      ['deploy', workflowOperations.deploy],
      ['undeploy', workflowOperations.undeploy],
      ['updatePublicApi', workflowOperations.updatePublicApi],
      ['activateVersion', workflowOperations.activateVersion],
      ['revertVersion', workflowOperations.revertVersion],
    ])(
      'workflowOperations.%s denies workspace_api_key so a long-lived key cannot deploy',
      (_name, operation) => {
        expect(operation.workspaceApiKey).toBe('deny')
      }
    )

    it('creating an API key from copilot denies workspace API keys', () => {
      expect(apiKeyOperations.createFromCopilot.workspaceApiKey).toBe('deny')
    })
  })
})
