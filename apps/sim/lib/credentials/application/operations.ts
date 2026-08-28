import type { ApplicationOperation } from '@/lib/core/application'
import { defineWorkspaceOperation, type WorkspaceOperation } from '@/lib/core/application'
import { CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION } from '@/lib/resource-policies/registry'

export type CredentialRole = 'member' | 'admin'

export type CredentialOperation<O extends WorkspaceOperation = WorkspaceOperation> = O & {
  readonly minimumCredentialRole: CredentialRole
}

/** Adds credential-resource policy to a workspace-scoped operation. */
export function defineCredentialOperation<
  const O extends WorkspaceOperation,
  const R extends CredentialRole,
>(
  operation: O,
  minimumCredentialRole: R
): CredentialOperation<O> & {
  readonly minimumCredentialRole: R
} {
  if (operation.principalKinds.includes('workspace_api_key')) {
    throw new Error(`Credential operation ${operation.id} requires a user-bearing principal`)
  }
  return Object.freeze({ ...operation, minimumCredentialRole })
}

const HUMAN_AND_COPILOT_PRINCIPALS = {
  principalKinds: ['session', 'personal_api_key', 'delegated'],
  delegatedServices: ['copilot'],
} as const

export const credentialOperations = {
  listInternal: defineWorkspaceOperation({
    id: 'credentials.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  listProviders: defineWorkspaceOperation({
    id: 'credentials.providers.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ['session', 'personal_api_key', 'workspace_api_key'],
  }),
  listConnections: defineWorkspaceOperation({
    id: 'credentials.connections.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ['session', 'personal_api_key', 'workspace_api_key'],
  }),
  createConnection: defineWorkspaceOperation({
    id: 'credentials.connections.create',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: ['session', 'personal_api_key'],
  }),
  prepareConnection: defineWorkspaceOperation({
    id: 'credentials.connections.prepare',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
  createServiceAccount: defineWorkspaceOperation({
    id: 'credentials.service_accounts.create',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: ['session', 'personal_api_key'],
  }),
  read: defineCredentialOperation(
    defineWorkspaceOperation({
      id: 'credentials.read',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      principalKinds: ['session'],
    }),
    'member'
  ),
  create: defineWorkspaceOperation({
    id: 'credentials.create',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  update: defineCredentialOperation(
    defineWorkspaceOperation({
      id: 'credentials.update',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      ...HUMAN_AND_COPILOT_PRINCIPALS,
    }),
    'admin'
  ),
  delete: defineCredentialOperation(
    defineWorkspaceOperation({
      id: 'credentials.delete',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      ...HUMAN_AND_COPILOT_PRINCIPALS,
    }),
    'admin'
  ),
  deleteMany: defineWorkspaceOperation({
    id: 'credentials.delete_many',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
  saveDraft: defineWorkspaceOperation({
    id: 'credentials.drafts.save',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  listMembers: defineWorkspaceOperation({
    id: 'credentials.members.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  upsertMember: defineCredentialOperation(
    defineWorkspaceOperation({
      id: 'credentials.members.upsert',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      principalKinds: ['session'],
    }),
    'admin'
  ),
  removeMember: defineCredentialOperation(
    defineWorkspaceOperation({
      id: 'credentials.members.remove',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      principalKinds: ['session'],
    }),
    'admin'
  ),
  launchConnection: defineWorkspaceOperation({
    id: 'credentials.connections.launch',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  useManagedOAuth: defineWorkspaceOperation({
    id: 'credentials.managed_oauth.use',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['delegated'],
    delegatedServices: ['executor'],
    resourcePolicy: {
      resourceType: 'credential_group',
      action: CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION,
    },
  }),
} as const

export interface CredentialUserOperation<Id extends string = string>
  extends ApplicationOperation<Id> {
  readonly principalKinds: readonly ['session']
}

function defineCredentialUserOperation<const Id extends string>(
  id: Id
): CredentialUserOperation<Id> {
  if (!id.trim()) throw new Error('Credential user operation ID must not be empty')
  return Object.freeze({ id, principalKinds: Object.freeze(['session'] as const) })
}

export const credentialUserOperations = {
  listMemberships: defineCredentialUserOperation('credentials.memberships.list'),
  leaveMembership: defineCredentialUserOperation('credentials.memberships.leave'),
  listOAuthConnections: defineCredentialUserOperation('credentials.oauth_connections.list'),
  listConnectedAccounts: defineCredentialUserOperation('credentials.accounts.list'),
  disconnectOAuth: defineCredentialUserOperation('credentials.oauth_connections.disconnect'),
} as const
