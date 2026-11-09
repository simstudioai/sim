import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

export const folderOperations = {
  // permission-group-exempt: a workspace's folder trees are governed by workspace role; each resource's own operations gate its contents
  list: defineWorkspaceOperation({
    id: 'folders.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
} as const
