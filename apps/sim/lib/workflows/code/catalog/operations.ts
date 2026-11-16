import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

/**
 * Semantic operations for the workflow-SDK block catalog.
 *
 * Same policy as `catalog.blocks.list` (s4 §2): a workspace read at the `read` role, reachable by
 * a workspace API key and by Copilot delegation, because it is the same per-workspace block
 * availability projected into the shape the workflow compiler reads.
 */
export const workflowCodeCatalogOperations = {
  // permission-group-exempt: the compile catalog is the block catalog in another shape; withholding it hides the product rather than restricting it
  read: defineWorkspaceOperation({
    id: 'workflows.code.catalog.read',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    contentDelivery: 'none',
    principalKinds: [
      'session',
      'personal_api_key',
      'oauth_access_token',
      'workspace_api_key',
      'delegated',
    ],
    delegatedServices: ['copilot'],
  }),
} as const
