import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

export const providerModelOperations = {
  list: defineWorkspaceOperation({
    id: 'provider_models.list',
    minimumRole: 'read',
    // permission-group-exempt: lists the models a workspace's own provider key can reach; running a model is gated where it executes.
    capability: 'none',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
} as const
