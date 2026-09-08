/**
 * @vitest-environment node
 */
import { permissionGroupScopeMock, permissionGroupScopeMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePermission: vi.fn(),
}))

const resolveGroupConfigMock = permissionGroupScopeMockFns.mockResolvePermissionGroupConfig

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: () => true,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

import type { WorkspaceOperation } from '@/lib/core/application'
import { authorizeWorkspaceOperation, PermissionGroupCapabilityError } from '@/lib/core/application'
import { mcpServerOperations } from '@/lib/mcp/application/operations'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

describe('MCP server operation registry', () => {
  it('requires a human subject for tool discovery', () => {
    expect(mcpServerOperations.discoverTools).toMatchObject({
      workspaceApiKey: 'deny',
      principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
      delegatedServices: ['copilot', 'executor'],
    })
  })

  it('admits only the executor delegation for tool execution', () => {
    expect(mcpServerOperations.executeTool).toMatchObject({
      id: 'mcp_servers.tools.execute',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      principalKinds: ['delegated'],
      delegatedServices: ['executor'],
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
        'oauth_access_token',
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

const sessionPrincipal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' } as const
const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
}

/**
 * Every operation's capability, by name.
 *
 * Pinned as a whole map rather than derived from the registry, because the
 * refusal tests below select their subjects with `operation.capability === x` —
 * a filter over the very field under test. Dropping the capability from one
 * operation would simply remove it from that filter and leave those tests green
 * (`mcp_servers.create`, which registers a server and stores its credentials
 * against the workspace, was verified to do exactly that). This map fails
 * instead.
 */
const EXPECTED_CAPABILITIES: Record<keyof typeof mcpServerOperations, string> = {
  list: 'mcp_tools.use',
  read: 'mcp_tools.use',
  create: 'mcp_tools.use',
  register: 'mcp_tools.use',
  update: 'mcp_tools.use',
  reconfigure: 'mcp_tools.use',
  delete: 'mcp_tools.use',
  discoverTools: 'mcp_tools.use',
  executeTool: 'mcp_tools.use',
  listManagedConnections: 'mcp_tools.use',
  listWorkflowDeployments: 'deploy.mcp',
  readWorkflowDeploymentServer: 'deploy.mcp',
  listWorkflowDeploymentTools: 'deploy.mcp',
  createWorkflowDeploymentServer: 'deploy.mcp',
  updateWorkflowDeploymentServer: 'deploy.mcp',
  deleteWorkflowDeploymentServer: 'deploy.mcp',
  deployWorkflowTool: 'deploy.mcp',
  undeployWorkflowTool: 'deploy.mcp',
}

describe('MCP operation capability declarations', () => {
  it('declares a capability on every operation, by name', () => {
    const declared = Object.fromEntries(
      Object.entries(mcpServerOperations).map(([key, operation]) => [key, operation.capability])
    )

    expect(declared).toEqual(EXPECTED_CAPABILITIES)
  })
})

/** `tools.execute` admits only the executor delegation, so a session cannot stand in for it. */
function sessionReachable(capability: string) {
  return Object.values(mcpServerOperations).filter(
    (operation) =>
      operation.capability === capability && operation.principalKinds.includes('session')
  )
}

/**
 * The declaration is only half the gate; these prove the funnel actually
 * refuses, so a capability could not be renamed into one nothing reads.
 */
describe('MCP operations under a withholding permission group', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('admin')
  })

  it('refuses every mcp_servers operation when the group blocks MCP tools', async () => {
    resolveGroupConfigMock.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disableMcpTools: true,
    })

    const registryOperations = sessionReachable('mcp_tools.use')
    expect(registryOperations.length).toBeGreaterThan(0)

    for (const operation of registryOperations) {
      await expect(
        authorizeWorkspaceOperation(sessionPrincipal, operation as WorkspaceOperation, context),
        operation.id
      ).rejects.toBeInstanceOf(PermissionGroupCapabilityError)
    }
  })

  it('refuses every workflow-deployment operation when the group hides MCP deployment', async () => {
    resolveGroupConfigMock.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideDeployMcp: true,
    })

    const deploymentOperations = sessionReachable('deploy.mcp')
    expect(deploymentOperations.length).toBeGreaterThan(0)

    for (const operation of deploymentOperations) {
      await expect(
        authorizeWorkspaceOperation(sessionPrincipal, operation as WorkspaceOperation, context),
        operation.id
      ).rejects.toBeInstanceOf(PermissionGroupCapabilityError)
    }
  })

  it('allows the same operations when the group withholds neither', async () => {
    resolveGroupConfigMock.mockResolvedValue(DEFAULT_PERMISSION_GROUP_CONFIG)

    for (const operation of [
      ...sessionReachable('mcp_tools.use'),
      ...sessionReachable('deploy.mcp'),
    ]) {
      await expect(
        authorizeWorkspaceOperation(sessionPrincipal, operation as WorkspaceOperation, context),
        operation.id
      ).resolves.toBeUndefined()
    }
  })
})
