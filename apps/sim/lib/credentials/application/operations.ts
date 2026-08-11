import { defineWorkspaceOperation } from '@/lib/core/application'

export const credentialOperations = {
  listConnections: defineWorkspaceOperation({
    id: 'credentials.connections.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ['personal_api_key', 'workspace_api_key'],
  }),
} as const
