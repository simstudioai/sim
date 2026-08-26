import { defineWorkspaceOperation } from '@/lib/core/application'

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
 */
export const catalogOperations = {
  listBlocks: defineWorkspaceOperation({
    id: 'catalog.blocks.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ['session', 'personal_api_key', 'workspace_api_key'],
  }),
  readBlock: defineWorkspaceOperation({
    id: 'catalog.blocks.read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ['session', 'personal_api_key', 'workspace_api_key'],
  }),
  listTools: defineWorkspaceOperation({
    id: 'catalog.tools.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ['session', 'personal_api_key', 'workspace_api_key'],
  }),
  readTool: defineWorkspaceOperation({
    id: 'catalog.tools.read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ['session', 'personal_api_key', 'workspace_api_key'],
  }),
  listConnectorTypes: defineWorkspaceOperation({
    id: 'catalog.connector_types.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ['session', 'personal_api_key', 'workspace_api_key'],
  }),
} as const
