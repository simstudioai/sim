import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

const ALL_PRINCIPAL_POLICY = {
  principalKinds: [
    'session',
    'personal_api_key',
    'oauth_access_token',
    'workspace_api_key',
    'delegated',
  ],
  delegatedServices: ['copilot'],
} as const
const HUMAN_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
  delegatedServices: ['copilot'],
} as const
const DISCOVERY_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
  delegatedServices: ['copilot', 'executor'],
} as const
const EXECUTION_PRINCIPAL_POLICY = {
  principalKinds: ['delegated'],
  delegatedServices: ['executor'],
} as const

/**
 * Two capabilities, because the family covers two different things.
 *
 * `mcp_servers.*` is the workspace's registry of external MCP servers — the
 * connections an agent calls tools through — so every one of them declares
 * `mcp_tools.use`. Gating only `tools.execute` would leave a group that blocks
 * MCP tools able to keep registering servers and storing their credentials
 * against the workspace, which is the accumulation the key exists to stop.
 *
 * `mcp_servers.workflow_deployments.*` is the opposite direction: publishing a
 * workflow *as* an MCP server, which is what `hideDeployMcp` names. Reads carry
 * `deploy.mcp` alongside the writes, so a group that withholds the deployment
 * surface does not still answer with what is published on it.
 */
export const mcpServerOperations = {
  list: defineWorkspaceOperation({
    id: 'mcp_servers.list',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'mcp_tools.use',
    ...ALL_PRINCIPAL_POLICY,
  }),
  listManagedConnections: defineWorkspaceOperation({
    id: 'mcp_servers.managed_connections.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'mcp_tools.use',
    principalKinds: ['session'],
  }),
  discoverTools: defineWorkspaceOperation({
    id: 'mcp_servers.tools.discover',
    oauthScope: 'api:write',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'mcp_tools.use',
    ...DISCOVERY_PRINCIPAL_POLICY,
  }),
  executeTool: defineWorkspaceOperation({
    id: 'mcp_servers.tools.execute',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'mcp_tools.use',
    ...EXECUTION_PRINCIPAL_POLICY,
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
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'deploy.mcp',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  /**
   * Reads one published server, and the tools it publishes.
   *
   * Both carry the `listWorkflowDeployments` policy rather than the
   * `mcp_servers.read` one beside them: the workflow-deployment family denies
   * workspace API keys throughout, and a detail read that admitted one would be
   * a wider door into the same data the list deliberately closes.
   */
  readWorkflowDeploymentServer: defineWorkspaceOperation({
    id: 'mcp_servers.workflow_deployments.read_server',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'deploy.mcp',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  listWorkflowDeploymentTools: defineWorkspaceOperation({
    id: 'mcp_servers.workflow_deployments.list_tools',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'deploy.mcp',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  createWorkflowDeploymentServer: defineWorkspaceOperation({
    id: 'mcp_servers.workflow_deployments.create_server',
    oauthScope: 'api:write',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'deploy.mcp',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  /**
   * `admin`, not `write`, because the body carries `isPublic`. A public server
   * answers `/api/mcp/serve/{serverId}` with no Sim credential, so flipping it
   * removes the authentication requirement from every workflow the server
   * publishes — the same authority `workflows.public_api.update` reserves for
   * admins. `create_server` already accepts `isPublic` at `admin`, so a lower
   * role here would only mean the cheaper path to the same grant.
   *
   * Copilot stays a principal, unlike `workflows.public_api.update`: this
   * family already admits it at `admin` for `create_server`, which grants the
   * identical visibility, so denying it only for the update would leave the
   * grant reachable while breaking the shipped rename tool.
   */
  updateWorkflowDeploymentServer: defineWorkspaceOperation({
    id: 'mcp_servers.workflow_deployments.update_server',
    oauthScope: 'api:write',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'deploy.mcp',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  deleteWorkflowDeploymentServer: defineWorkspaceOperation({
    id: 'mcp_servers.workflow_deployments.delete_server',
    oauthScope: 'api:write',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'deploy.mcp',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  deployWorkflowTool: defineWorkspaceOperation({
    id: 'mcp_servers.workflow_deployments.deploy_tool',
    oauthScope: 'api:write',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'deploy.mcp',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  undeployWorkflowTool: defineWorkspaceOperation({
    id: 'mcp_servers.workflow_deployments.undeploy_tool',
    oauthScope: 'api:write',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'deploy.mcp',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  read: defineWorkspaceOperation({
    id: 'mcp_servers.read',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'mcp_tools.use',
    ...ALL_PRINCIPAL_POLICY,
  }),
  create: defineWorkspaceOperation({
    id: 'mcp_servers.create',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'mcp_tools.use',
    ...ALL_PRINCIPAL_POLICY,
  }),
  register: defineWorkspaceOperation({
    id: 'mcp_servers.register',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'mcp_tools.use',
    ...ALL_PRINCIPAL_POLICY,
  }),
  update: defineWorkspaceOperation({
    id: 'mcp_servers.update',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'mcp_tools.use',
    ...ALL_PRINCIPAL_POLICY,
  }),
  reconfigure: defineWorkspaceOperation({
    id: 'mcp_servers.reconfigure',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'mcp_tools.use',
    ...ALL_PRINCIPAL_POLICY,
  }),
  delete: defineWorkspaceOperation({
    id: 'mcp_servers.delete',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'mcp_tools.use',
    ...ALL_PRINCIPAL_POLICY,
  }),
} as const

export type McpServerOperation = (typeof mcpServerOperations)[keyof typeof mcpServerOperations]
