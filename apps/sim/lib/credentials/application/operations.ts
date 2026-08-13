import { defineWorkspaceOperation } from '@/lib/core/application'

export const credentialOperations = {
  listProviders: defineWorkspaceOperation({
    id: 'credentials.providers.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ['personal_api_key', 'workspace_api_key'],
  }),
  listConnections: defineWorkspaceOperation({
    id: 'credentials.connections.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ['personal_api_key', 'workspace_api_key'],
  }),
  createConnection: defineWorkspaceOperation({
    id: 'credentials.connections.create',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: ['personal_api_key'],
  }),
  createServiceAccount: defineWorkspaceOperation({
    id: 'credentials.service_accounts.create',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: ['personal_api_key'],
  }),
  delete: defineWorkspaceOperation({
    id: 'credentials.delete',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['personal_api_key'],
  }),
  launchConnection: defineWorkspaceOperation({
    id: 'credentials.connections.launch',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
} as const
