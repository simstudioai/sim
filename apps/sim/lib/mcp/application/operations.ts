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
  /**
   * Publishing a workflow as an MCP server was reachable only through Copilot,
   * so all six operations below declared `principalKinds: ['delegated']` — not
   * because a human may not perform them, but because no human-facing surface
   * existed. `/api/v2/workflow-mcp-servers` is that surface, so each now admits
   * the two human principal kinds alongside the Copilot delegation that already
   * held them.
   *
   * Roles are unchanged, and every one keeps `workspaceApiKey: 'deny'`: an MCP
   * server publishes a workflow for execution by an outside agent, which is an
   * authority grant that needs an accountable human rather than a machine
   * credential. The three `admin` operations could not accept a workspace key
   * anyway — it has a write ceiling — so `deny` is the honest declaration for
   * the `read` and `write` ones too rather than a split policy across one
   * resource family.
   */
  listWorkflowDeployments: defineWorkspaceOperation({
    id: 'mcp_servers.workflow_deployments.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  createWorkflowDeploymentServer: defineWorkspaceOperation({
    id: 'mcp_servers.workflow_deployments.create_server',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  updateWorkflowDeploymentServer: defineWorkspaceOperation({
    id: 'mcp_servers.workflow_deployments.update_server',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  deleteWorkflowDeploymentServer: defineWorkspaceOperation({
    id: 'mcp_servers.workflow_deployments.delete_server',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  deployWorkflowTool: defineWorkspaceOperation({
    id: 'mcp_servers.workflow_deployments.deploy_tool',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  undeployWorkflowTool: defineWorkspaceOperation({
    id: 'mcp_servers.workflow_deployments.undeploy_tool',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    ...HUMAN_PRINCIPAL_POLICY,
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
