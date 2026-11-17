import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

/**
 * Reads and applies a whole workspace as source. Each change runs through the child use case
 * that owns it (`createTableUseCase`, `applyWorkflowSource`, …), which enforces its own role,
 * capability and workspace-key policy: a workspace API key may read and apply here, and a child
 * that refuses it (workflow source denies workspace keys) is reported per resource as
 * `E_APPLY_FORBIDDEN` before anything is written. Not offered to Copilot.
 */
const SOURCE_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'workspace_api_key'],
} as const

export const workspaceSourceOperations = {
  // permission-group-exempt: each kind's resources are read through their own use cases, which apply that kind's capability
  read: defineWorkspaceOperation({
    id: 'workspaces.source.read',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...SOURCE_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: each change runs through the use case that owns it, which applies that kind's capability
  apply: defineWorkspaceOperation({
    id: 'workspaces.source.apply',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...SOURCE_PRINCIPAL_POLICY,
  }),
} as const
