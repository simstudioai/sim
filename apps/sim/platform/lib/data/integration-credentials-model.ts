import type {
  WorkspaceCredential,
  WorkspaceCredentialMember,
} from '@/lib/api/contracts/credentials'
import type { WorkspaceUser } from '@/lib/api/contracts/workspaces'
import type { IntegrationPerson } from '@/platform/lib/integrations/center-model'
import type {
  CredentialMember,
  IntegrationCredential,
} from '@/platform/lib/integrations/credential-model'
import type { IntegrationAccount } from '@/platform/shared/integrations'

/** The credential kinds an app's page lists; secrets belong to workspace Settings. */
const APP_CREDENTIAL_TYPES = new Set(['oauth', 'service_account', 'personal_token'] as const)
type AppCredentialType = typeof APP_CREDENTIAL_TYPES extends Set<infer T> ? T : never

function isAppCredentialType(type: string): type is AppCredentialType {
  return APP_CREDENTIAL_TYPES.has(type as AppCredentialType)
}

/**
 * A workspace credential in the credential page's vocabulary. A personal token belongs to the
 * person who connected it; anything else is shared through the workspace. A grant still pending
 * confers no role beyond member. Members arrive with the credential's own read and stay empty
 * until then.
 */
export function toWorkspaceIntegrationCredential(
  credential: WorkspaceCredential,
  {
    appId,
    workspace,
    canReconnect,
    instanceLabel,
  }: {
    appId: string
    workspace: { id: string; name: string }
    canReconnect: boolean
    /** What the app's connection calls the credential's immutable host or environment. */
    instanceLabel?: string
  }
): IntegrationCredential | null {
  if (!isAppCredentialType(credential.type) || !credential.providerId) return null
  return {
    id: credential.id,
    appId,
    providerId: credential.providerId,
    type: credential.type,
    displayName: credential.displayName,
    description: credential.description ?? '',
    instanceUrl: credential.instanceUrl,
    instanceLabel,
    role: credential.status === 'pending' ? 'member' : (credential.role ?? 'member'),
    status: 'active',
    canReconnect,
    scope:
      credential.type === 'personal_token'
        ? { kind: 'personal', ownerId: credential.createdBy }
        : { kind: 'workspace', id: workspace.id, name: workspace.name },
    members: [],
  }
}

/**
 * A member's own organization account, which only its owner holds: the organization connects it
 * for Search and the assistant, and nobody else can be given access to it.
 */
export function toMemberAccountCredential(
  account: IntegrationAccount,
  { appId, providerId, viewerId }: { appId: string; providerId: string; viewerId: string }
): IntegrationCredential {
  return {
    id: account.id,
    appId,
    providerId,
    type: 'oauth',
    displayName: account.label,
    description: '',
    role: 'admin',
    status: account.status,
    canReconnect: account.canReconnect,
    scope: { kind: 'personal', ownerId: viewerId },
    members: [],
  }
}

/** A credential's grants as the access table reads them, keyed by the person they name. */
export function toCredentialMembers(
  members: readonly WorkspaceCredentialMember[]
): CredentialMember[] {
  return members.map((member) => {
    const name = member.userName || member.userEmail || member.userId
    return {
      id: member.userId,
      userId: member.userId,
      name,
      email: member.userEmail ?? undefined,
      src: member.userImage ?? undefined,
      role: member.role,
      roleSource: member.roleSource ?? 'explicit',
      explicitAdmin: member.explicitAdmin,
      status: member.status,
    }
  })
}

/** A person as the credential pages name them. */
export function toIntegrationPerson(user: {
  id: string
  name?: string | null
  email: string
  image?: string | null
}): IntegrationPerson {
  return {
    id: user.id,
    name: user.name || user.email,
    email: user.email,
    src: user.image ?? undefined,
  }
}

/** The workspace's people a credential can be shared with. */
export function toIntegrationPeople(users: readonly WorkspaceUser[]): IntegrationPerson[] {
  return users.map((user) => toIntegrationPerson({ ...user, id: user.userId }))
}

/**
 * The explicit grants an access edit proposes, for the operation that makes them the credential's
 * own. Inherited admins are not grants. The viewer revoking their own access is leaving, which its
 * own operation performs, so their grant stays in the list.
 */
export function credentialGrants(
  previous: readonly CredentialMember[],
  next: readonly CredentialMember[],
  viewerId: string
): { userId: string; role: CredentialMember['role'] }[] {
  return next.flatMap((member) => {
    if (member.roleSource !== 'explicit') return []
    if (member.status !== 'revoked') return [{ userId: member.userId, role: member.role }]
    const prior = previous.find((entry) => entry.userId === member.userId)
    return member.userId === viewerId && prior && prior.status !== 'revoked'
      ? [{ userId: member.userId, role: prior.role }]
      : []
  })
}
