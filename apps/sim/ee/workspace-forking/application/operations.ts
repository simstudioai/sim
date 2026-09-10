import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

const adminPolicy = {
  minimumRole: 'admin',
  workspaceApiKey: 'deny',
  principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
} as const

export const forkOperations = {
  /**
   * permission-group-exempt: fork discovery is workspace metadata governed by the source admin role.
   */
  discover: defineWorkspaceOperation({
    ...adminPolicy,
    capability: 'none',
    id: 'workspaces.fork.discover',
    oauthScope: 'api:read',
  }),
  /**
   * permission-group-exempt: fork preview uses source admin and separately validates creation policy and copied graph capabilities.
   */
  preview: defineWorkspaceOperation({
    ...adminPolicy,
    capability: 'none',
    id: 'workspaces.fork.preview',
    oauthScope: 'api:write',
  }),
  /**
   * permission-group-exempt: fork creation uses source admin and separately enforces workspace creation policy and copied graph capabilities.
   */
  create: defineWorkspaceOperation({
    ...adminPolicy,
    capability: 'none',
    id: 'workspaces.fork.create',
    oauthScope: 'api:write',
  }),
  /**
   * permission-group-exempt: sync preview uses admin roles on both sides and separately validates graph and resource capabilities.
   */
  syncPreview: defineWorkspaceOperation({
    ...adminPolicy,
    capability: 'none',
    id: 'workspaces.fork.sync.preview',
    oauthScope: 'api:write',
  }),
  /**
   * permission-group-exempt: sync uses admin roles on both sides and separately enforces graph and resource capabilities.
   */
  sync: defineWorkspaceOperation({
    ...adminPolicy,
    capability: 'none',
    id: 'workspaces.fork.sync',
    oauthScope: 'api:write',
  }),
  /**
   * permission-group-exempt: edge mappings are workspace configuration governed by admin roles on both sides.
   */
  mappingsRead: defineWorkspaceOperation({
    ...adminPolicy,
    capability: 'none',
    id: 'workspaces.fork.mappings.read',
    oauthScope: 'api:read',
  }),
  /**
   * permission-group-exempt: edge mapping changes use admin roles on both sides and validate access to each destination resource.
   */
  mappingsUpdate: defineWorkspaceOperation({
    ...adminPolicy,
    capability: 'none',
    id: 'workspaces.fork.mappings.update',
    oauthScope: 'api:write',
  }),
  /**
   * permission-group-exempt: restoring a prior deployment is governed by the target admin role and deployment policy.
   */
  rollback: defineWorkspaceOperation({
    ...adminPolicy,
    capability: 'none',
    id: 'workspaces.fork.rollback',
    oauthScope: 'api:write',
  }),
  /**
   * permission-group-exempt: removing a fork relationship is governed by the acting workspace admin role.
   */
  unlink: defineWorkspaceOperation({
    ...adminPolicy,
    capability: 'none',
    id: 'workspaces.fork.unlink',
    oauthScope: 'api:write',
  }),
  /**
   * permission-group-exempt: sync exclusions are workspace configuration governed by the acting workspace admin role.
   */
  exclusions: defineWorkspaceOperation({
    ...adminPolicy,
    capability: 'none',
    id: 'workspaces.fork.exclusions',
    oauthScope: 'api:write',
  }),
} as const
