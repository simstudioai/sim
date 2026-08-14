import { defineWorkspaceOperation, type WorkspaceOperation } from '@/lib/core/application'

export type CredentialAdminOperation<O extends WorkspaceOperation = WorkspaceOperation> = O & {
  readonly minimumCredentialRole: 'admin'
}

/** Adds credential-admin policy to a workspace-scoped operation. */
export function defineCredentialAdminOperation<const O extends WorkspaceOperation>(
  operation: O
): CredentialAdminOperation<O> {
  if (operation.principalKinds.includes('workspace_api_key')) {
    throw new Error(`Credential admin operation ${operation.id} requires a human principal`)
  }
  return Object.freeze({ ...operation, minimumCredentialRole: 'admin' as const })
}

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
  delete: defineCredentialAdminOperation(
    defineWorkspaceOperation({
      id: 'credentials.delete',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      principalKinds: ['personal_api_key'],
    })
  ),
  launchConnection: defineWorkspaceOperation({
    id: 'credentials.connections.launch',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
} as const
