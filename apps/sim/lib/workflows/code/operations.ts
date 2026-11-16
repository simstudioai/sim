import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

/** Semantic operations for authoring workflows as code, beyond the block catalog. */
export const workflowCodeOperations = {
  /**
   * The workspace resources a workflow file can name, by key. A read: any member may list them,
   * as any member may read the source that names them; a workspace API key may too, like
   * `workflows.source.read`. Listing allocates keys for resources that have none, which changes
   * no resource (see `readResourceManifest`).
   */
  // permission-group-exempt: lists resource names and key bindings already visible to every workspace member; no group capability withholds them
  readResourceManifest: defineWorkspaceOperation({
    id: 'workflows.code.resource_manifest.read',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'workspace_api_key'],
  }),
} as const
