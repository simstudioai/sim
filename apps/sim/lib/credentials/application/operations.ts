import type {
  ApplicationOperation,
  OperationDeclarableCapability,
} from '@/lib/core/application/operation'
import {
  defineWorkspaceOperation,
  type WorkspaceOperation,
} from '@/lib/core/application/workspace-operation'
import { CAPABILITY_RULES } from '@/lib/permission-groups/capabilities'
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
  principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
  delegatedServices: ['copilot'],
} as const

export const credentialOperations = {
  resolvePersonalToken: defineCredentialOperation(
    defineWorkspaceOperation({
      id: 'credentials.personal_tokens.resolve',
      oauthScope: 'api:read',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      capability: 'integrations.manage',
      ...HUMAN_AND_COPILOT_PRINCIPALS,
    }),
    'member'
  ),
  startPersonalConnection: defineWorkspaceOperation({
    id: 'credentials.personal.connect',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'integrations.manage',
    principalKinds: ['session'],
  }),
  listPersonal: defineWorkspaceOperation({
    id: 'credentials.personal.list',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'integrations.manage',
    ...HUMAN_AND_COPILOT_PRINCIPALS,
  }),
  authorizePersonal: defineWorkspaceOperation({
    id: 'credentials.personal.authorize',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'integrations.manage',
    ...HUMAN_AND_COPILOT_PRINCIPALS,
  }),
  listInternal: defineWorkspaceOperation({
    id: 'credentials.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'integrations.manage',
    principalKinds: ['session'],
  }),
  listProviders: defineWorkspaceOperation({
    id: 'credentials.providers.list',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'integrations.manage',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'workspace_api_key'],
  }),
  listConnections: defineWorkspaceOperation({
    id: 'credentials.connections.list',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'integrations.manage',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'workspace_api_key'],
  }),
  /**
   * `integrations.manage`, like every other credential operation — these three
   * take a *target*, not a scope: `providerId` connects a personal account,
   * `credentialId` re-authorizes a credential the workspace already holds. Only
   * the first is what `disablePersonalCredentials` withholds, so the narrower
   * `credentials.personal` is asserted on that branch inside
   * `resolveCredentialConnectionTarget` rather than declared here. Declaring it
   * here withheld the reconnect too — refusing the workspace-shared credentials
   * that same setting exists to mandate — and, because an operation declares one
   * capability, let a group that hid the whole Integrations module still connect.
   */
  createConnection: defineWorkspaceOperation({
    id: 'credentials.connections.create',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'integrations.manage',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
  }),
  prepareConnection: defineWorkspaceOperation({
    id: 'credentials.connections.prepare',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'integrations.manage',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
  createServiceAccount: defineWorkspaceOperation({
    id: 'credentials.service_accounts.create',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'integrations.manage',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
  }),
  read: defineCredentialOperation(
    defineWorkspaceOperation({
      id: 'credentials.read',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      capability: 'integrations.manage',
      principalKinds: ['session'],
    }),
    'member'
  ),
  create: defineWorkspaceOperation({
    id: 'credentials.create',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'integrations.manage',
    principalKinds: ['session'],
  }),
  update: defineCredentialOperation(
    defineWorkspaceOperation({
      id: 'credentials.update',
      oauthScope: 'api:write',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      capability: 'integrations.manage',
      ...HUMAN_AND_COPILOT_PRINCIPALS,
    }),
    'admin'
  ),
  delete: defineCredentialOperation(
    defineWorkspaceOperation({
      id: 'credentials.delete',
      oauthScope: 'api:write',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      capability: 'integrations.manage',
      ...HUMAN_AND_COPILOT_PRINCIPALS,
    }),
    'admin'
  ),
  deleteMany: defineWorkspaceOperation({
    id: 'credentials.delete_many',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'integrations.manage',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
  saveDraft: defineWorkspaceOperation({
    id: 'credentials.drafts.save',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'integrations.manage',
    principalKinds: ['session'],
  }),
  listMembers: defineWorkspaceOperation({
    id: 'credentials.members.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'integrations.manage',
    principalKinds: ['session'],
  }),
  upsertMember: defineCredentialOperation(
    defineWorkspaceOperation({
      id: 'credentials.members.upsert',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      capability: 'integrations.manage',
      principalKinds: ['session'],
    }),
    'admin'
  ),
  removeMember: defineCredentialOperation(
    defineWorkspaceOperation({
      id: 'credentials.members.remove',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      capability: 'integrations.manage',
      principalKinds: ['session'],
    }),
    'admin'
  ),
  launchConnection: defineWorkspaceOperation({
    id: 'credentials.connections.launch',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'integrations.manage',
    principalKinds: ['session'],
  }),
  completeConnection: defineWorkspaceOperation({
    id: 'credentials.connections.complete',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'integrations.manage',
    principalKinds: ['session'],
  }),
  useManagedOAuth: defineWorkspaceOperation({
    id: 'credentials.managed_oauth.use',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'integrations.manage',
    principalKinds: ['delegated'],
    delegatedServices: ['executor', 'copilot'],
    resourcePolicy: {
      resourceType: 'credential_group',
      action: CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION,
    },
  }),
  useManagedMcp: defineWorkspaceOperation({
    id: 'credentials.managed_mcp.use',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'integrations.manage',
    principalKinds: ['delegated'],
    delegatedServices: ['executor'],
    resourcePolicy: {
      resourceType: 'credential_group',
      action: CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION,
    },
  }),
} as const

/**
 * A credential operation whose resource is the acting user's own account rather
 * than a workspace, so it carries no role and no workspace-key policy.
 *
 * It still carries a `capability`, and required rather than optional for the
 * same reason `defineWorkspaceOperation` requires one: an absent field cannot be
 * told apart from an unreviewed one. Listing and disconnecting a user's OAuth
 * connections is exactly what `hideIntegrationsTab` claims to revoke, and these
 * operations shipped with no capability at all — invisibly, because this factory
 * does not call `defineWorkspaceOperation` and so is read by neither that
 * builder's definition-time guard nor `check:permission-group-enforcement`,
 * which parses `defineWorkspaceOperation` call sites out of the source text.
 */
export interface CredentialUserOperation<Id extends string = string>
  extends ApplicationOperation<Id> {
  readonly principalKinds: readonly ['session']
  readonly capability: OperationDeclarableCapability | 'none'
}

function defineCredentialUserOperation<const Id extends string>(
  id: Id,
  capability: OperationDeclarableCapability | 'none'
): CredentialUserOperation<Id> {
  if (!id.trim()) throw new Error('Credential user operation ID must not be empty')
  if (capability === undefined) {
    throw new Error(
      `Credential user operation ${id} declares no capability; name one, or 'none' with a reason`
    )
  }
  if (capability !== 'none') {
    const rule = CAPABILITY_RULES[capability]
    if (!rule)
      throw new Error(`Credential user operation ${id} names unknown capability ${capability}`)
    /**
     * A parameterized rule reads a value only the request carries, which
     * `defineAuthorizedCredentialUserUseCase` never sees; declared here it would
     * read as enforced while nothing applied it.
     */
    if (rule.kind !== 'static') {
      throw new Error(
        `Credential user operation ${id} declares parameterized capability ${capability}; assert it from the use case instead`
      )
    }
  }
  return Object.freeze({ id, capability, principalKinds: Object.freeze(['session'] as const) })
}

/**
 * All five take `integrations.manage`, matching every other credential
 * operation that is not personal-scope by construction — `credentials.list`,
 * `credentials.connections.list`, `credentials.members.list` and the rest above.
 * Not `credentials.personal`: that one is reserved for the OAuth *connect* flow,
 * whose credential is personal by construction, and an organization that
 * revokes the Integrations module means members cannot see or remove a
 * connection either.
 */
export const credentialUserOperations = {
  listMemberships: defineCredentialUserOperation(
    'credentials.memberships.list',
    'integrations.manage'
  ),
  leaveMembership: defineCredentialUserOperation(
    'credentials.memberships.leave',
    'integrations.manage'
  ),
  listOAuthConnections: defineCredentialUserOperation(
    'credentials.oauth_connections.list',
    'integrations.manage'
  ),
  listConnectedAccounts: defineCredentialUserOperation(
    'credentials.accounts.list',
    'integrations.manage'
  ),
  disconnectOAuth: defineCredentialUserOperation(
    'credentials.oauth_connections.disconnect',
    'integrations.manage'
  ),
} as const
