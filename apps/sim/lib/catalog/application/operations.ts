import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

/**
 * Semantic operations for reading Sim's code-defined catalogs.
 *
 * All six share the policy of `credentials.providers.list`: a workspace-scoped
 * read at the `read` role, reachable by a workspace API key. That is the exact
 * shipped precedent for "a code-defined registry whose availability is evaluated
 * per workspace", and these catalogs are the same thing — filtered by the
 * workspace's integration allowlist, the organization's revealed preview blocks,
 * the deployment's allowlist, and the workspace's own deployed custom blocks.
 *
 * No `delegated` principal kind: Copilot reads these catalogs through its own
 * tools, which share the projection rather than the use case, so adding one
 * would widen authorization for a caller that does not exist.
 *
 * The block and tool catalogs name no capability. They are the set of things
 * the editor can render at all, already filtered per workspace, and the
 * capabilities that matter — MCP tools, custom tools, skills — are enforced on
 * the operations that use those tools rather than on the list that describes
 * them. Withholding the catalog would empty the builder rather than withhold
 * anything a group names.
 */
export const catalogOperations = {
  // permission-group-exempt: the block catalog is what the editor renders; emptying it hides the product rather than restricting it
  listBlocks: defineWorkspaceOperation({
    id: 'catalog.blocks.list',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'workspace_api_key'],
  }),
  // permission-group-exempt: one entry of the same catalog listBlocks returns, so it cannot be governed differently
  readBlock: defineWorkspaceOperation({
    id: 'catalog.blocks.read',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'workspace_api_key'],
  }),
  // permission-group-exempt: describes which tools exist; whether a member may call one is decided on that tool's own operation
  listTools: defineWorkspaceOperation({
    id: 'catalog.tools.list',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'workspace_api_key'],
  }),
  // permission-group-exempt: one entry of the same catalog listTools returns, so it cannot be governed differently
  readTool: defineWorkspaceOperation({
    id: 'catalog.tools.read',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'workspace_api_key'],
  }),
  /**
   * The only catalog with a capability: it enumerates knowledge-base connector
   * types and nothing else, so it exists to configure a knowledge base. A group
   * with `hideKnowledgeBaseTab` set has no use for the list.
   */
  listConnectorTypes: defineWorkspaceOperation({
    id: 'catalog.connector_types.list',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'knowledge.use',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'workspace_api_key'],
  }),
} as const
