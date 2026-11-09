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

/** A workspace credential as the workspace's credential list returns it. */
export type AppWorkspaceCredential = WorkspaceCredential

/** The credential kinds an app's page lists; secrets belong to workspace Settings. */
const APP_CREDENTIAL_TYPES = new Set(['oauth', 'service_account', 'personal_token'] as const)
type AppCredentialType = typeof APP_CREDENTIAL_TYPES extends Set<infer T> ? T : never

function isAppCredentialType(type: string): type is AppCredentialType {
  return APP_CREDENTIAL_TYPES.has(type as AppCredentialType)
}

/**
 * A workspace credential in the credential page's vocabulary. A personal token belongs to the
 * person who connected it; anything else is shared through the workspace. Members arrive with
 * the credential's own read and stay empty until then.
 */
export function toWorkspaceIntegrationCredential(
  credential: AppWorkspaceCredential,
  {
    appId,
    workspace,
    canReconnect,
    members = [],
  }: {
    appId: string
    workspace: { id: string; name: string }
    canReconnect: boolean
    members?: readonly CredentialMember[]
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
    role: credential.role ?? 'member',
    status: 'active',
    canReconnect,
    scope:
      credential.type === 'personal_token'
        ? { kind: 'personal', ownerId: credential.createdBy }
        : { kind: 'workspace', id: workspace.id, name: workspace.name },
    members,
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

/** The workspace's people a credential can be shared with. */
export function toIntegrationPeople(users: readonly WorkspaceUser[]): IntegrationPerson[] {
  return users.map((user) => ({
    id: user.userId,
    name: user.name || user.email,
    email: user.email,
    src: user.image ?? undefined,
  }))
}

export interface CredentialMemberChanges {
  /** Grants to add or whose role changes; the operation is an idempotent upsert. */
  upserts: { userId: string; role: CredentialMember['role'] }[]
  /** People whose access is revoked by someone else. */
  removals: string[]
}

/**
 * What one access edit asks of the server. The access table proposes the whole member list; this
 * names the grants that changed. The viewer revoking their own access is leaving, which its own
 * operation performs, so it is never a removal here.
 */
export function credentialMemberChanges(
  previous: readonly CredentialMember[],
  next: readonly CredentialMember[],
  viewerId: string
): CredentialMemberChanges {
  const before = new Map(previous.map((member) => [member.userId, member]))
  const upserts: CredentialMemberChanges['upserts'] = []
  const removals: string[] = []
  for (const member of next) {
    const prior = before.get(member.userId)
    if (member.status === 'revoked') {
      if (prior && prior.status !== 'revoked' && member.userId !== viewerId)
        removals.push(member.userId)
      continue
    }
    if (member.roleSource !== 'explicit') continue
    if (!prior || prior.status === 'revoked' || prior.role !== member.role)
      upserts.push({ userId: member.userId, role: member.role })
  }
  return { upserts, removals }
}
