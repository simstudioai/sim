/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { mcpServerOperations } from '@/lib/mcp/application/operations'

describe('MCP server operation registry', () => {
  it('requires a human subject for tool discovery', () => {
    expect(mcpServerOperations.discoverTools).toMatchObject({
      workspaceApiKey: 'deny',
      principalKinds: ['session', 'personal_api_key', 'delegated'],
      delegatedServices: ['copilot'],
    })
  })

  /**
   * The six workflow-deployment operations were widened from `['delegated']` to
   * human principals when `/api/v2/workflow-mcp-servers` shipped. Their roles
   * and workspace-key policy are the only thing standing between a member and a
   * server published for unauthenticated execution, so each is pinned here.
   */
  const WORKFLOW_DEPLOYMENT_OPERATIONS = {
    listWorkflowDeployments: {
      id: 'mcp_servers.workflow_deployments.list',
      minimumRole: 'read',
    },
    createWorkflowDeploymentServer: {
      id: 'mcp_servers.workflow_deployments.create_server',
      minimumRole: 'admin',
    },
    updateWorkflowDeploymentServer: {
      id: 'mcp_servers.workflow_deployments.update_server',
      minimumRole: 'admin',
    },
    deleteWorkflowDeploymentServer: {
      id: 'mcp_servers.workflow_deployments.delete_server',
      minimumRole: 'admin',
    },
    deployWorkflowTool: {
      id: 'mcp_servers.workflow_deployments.deploy_tool',
      minimumRole: 'admin',
    },
    undeployWorkflowTool: {
      id: 'mcp_servers.workflow_deployments.undeploy_tool',
      minimumRole: 'admin',
    },
  } as const

  it('pins the role of every workflow-deployment operation', () => {
    for (const [key, expected] of Object.entries(WORKFLOW_DEPLOYMENT_OPERATIONS)) {
      const operation = mcpServerOperations[key as keyof typeof mcpServerOperations]
      expect(operation, key).toMatchObject(expected)
    }
  })

  /**
   * `update_server` carries `isPublic`, and a public server answers
   * `/api/mcp/serve/{serverId}` with no Sim credential. `write` here would let a
   * member remove authentication from every workflow the server publishes,
   * which is the authority `create_server` and `workflows.public_api.update`
   * both reserve for admins.
   */
  it('requires admin to change a published server, matching create and delete', () => {
    expect(mcpServerOperations.updateWorkflowDeploymentServer.minimumRole).toBe('admin')
    expect(mcpServerOperations.updateWorkflowDeploymentServer.minimumRole).toBe(
      mcpServerOperations.createWorkflowDeploymentServer.minimumRole
    )
  })

  it('denies workspace API keys across the whole workflow-deployment family', () => {
    for (const key of Object.keys(WORKFLOW_DEPLOYMENT_OPERATIONS)) {
      const operation = mcpServerOperations[key as keyof typeof mcpServerOperations]
      expect(operation.workspaceApiKey, operation.id).toBe('deny')
      expect(operation.principalKinds, operation.id).not.toContain('workspace_api_key')
    }
  })

  it('admits only human principals and copilot delegation for workflow deployments', () => {
    for (const key of Object.keys(WORKFLOW_DEPLOYMENT_OPERATIONS)) {
      const operation = mcpServerOperations[key as keyof typeof mcpServerOperations]
      expect(operation.principalKinds, operation.id).toEqual([
        'session',
        'personal_api_key',
        'delegated',
      ])
      expect(operation.delegatedServices, operation.id).toEqual(['copilot'])
      expect(Object.isFrozen(operation), operation.id).toBe(true)
    }
  })

  it('uses unique stable operation IDs', () => {
    const ids = Object.values(mcpServerOperations).map((operation) => operation.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
