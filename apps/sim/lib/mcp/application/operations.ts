import { defineWorkspaceOperation } from '@/lib/core/application'

const ALL_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key', 'delegated'],
  delegatedServices: ['copilot'],
} as const
const HUMAN_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'delegated'],
  delegatedServices: ['copilot'],
} as const

export const mcpServerOperations = {
  list: defineWorkspaceOperation({
    id: 'mcp_servers.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...ALL_PRINCIPAL_POLICY,
  }),
  discoverTools: defineWorkspaceOperation({
    id: 'mcp_servers.tools.discover',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  listWorkflowDeployments: defineWorkspaceOperation({
    id: 'mcp_servers.workflow_deployments.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
  createWorkflowDeploymentServer: defineWorkspaceOperation({
    id: 'mcp_servers.workflow_deployments.create_server',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
  updateWorkflowDeploymentServer: defineWorkspaceOperation({
    id: 'mcp_servers.workflow_deployments.update_server',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
  deleteWorkflowDeploymentServer: defineWorkspaceOperation({
    id: 'mcp_servers.workflow_deployments.delete_server',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
  deployWorkflowTool: defineWorkspaceOperation({
    id: 'mcp_servers.workflow_deployments.deploy_tool',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
  undeployWorkflowTool: defineWorkspaceOperation({
    id: 'mcp_servers.workflow_deployments.undeploy_tool',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
  read: defineWorkspaceOperation({
    id: 'mcp_servers.read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...ALL_PRINCIPAL_POLICY,
  }),
  create: defineWorkspaceOperation({
    id: 'mcp_servers.create',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_PRINCIPAL_POLICY,
  }),
  register: defineWorkspaceOperation({
    id: 'mcp_servers.register',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_PRINCIPAL_POLICY,
  }),
  update: defineWorkspaceOperation({
    id: 'mcp_servers.update',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_PRINCIPAL_POLICY,
  }),
  reconfigure: defineWorkspaceOperation({
    id: 'mcp_servers.reconfigure',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_PRINCIPAL_POLICY,
  }),
  delete: defineWorkspaceOperation({
    id: 'mcp_servers.delete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_PRINCIPAL_POLICY,
  }),
} as const

export type McpServerOperation = (typeof mcpServerOperations)[keyof typeof mcpServerOperations]
