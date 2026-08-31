import { defineWorkspaceOperation } from '@/lib/core/application'

export const selectorOperations = {
  execute: defineWorkspaceOperation({
    id: 'selectors.execute',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
} as const
