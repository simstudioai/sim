import { db } from '@sim/db'
import { credential, credentialMember, credentialTypeEnum } from '@sim/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { checkWorkspaceAccess, type WorkspaceAccess } from '@/lib/workspaces/permissions/utils'

type ActiveCredentialMember = typeof credentialMember.$inferSelect
type CredentialRecord = typeof credential.$inferSelect

export type CredentialType = (typeof credentialTypeEnum.enumValues)[number]

/**
 * Credential types shared at the workspace level — every type except a user's
 * personal env vars. Derived from the enum so a newly added credential type is
 * treated as shared by default, keeping visibility, role, and admin derivation
 * consistent instead of drifting against a hand-maintained inclusion list.
 */
export const SHARED_CREDENTIAL_TYPES = credentialTypeEnum.enumValues.filter(
  (type) => type !== 'env_personal'
)

/** Whether a credential is shared at the workspace level (i.e. not a personal env var). */
export function isSharedCredentialType(type: CredentialType): boolean {
  return type !== 'env_personal'
}

/**
 * Whether a user is an admin of a credential: an explicit credential-member admin,
 * or — for shared credentials only — a workspace admin (workspace admins are
 * derived credential admins, but never for personal env vars).
 */
export function deriveCredentialAdmin(params: {
  credentialType: CredentialType
  memberRole: ActiveCredentialMember['role'] | null | undefined
  workspaceCanAdmin: boolean
}): boolean {
  return (
    params.memberRole === 'admin' ||
    (isSharedCredentialType(params.credentialType) && params.workspaceCanAdmin)
  )
}

export interface CredentialActorContext {
  credential: CredentialRecord | null
  member: ActiveCredentialMember | null
  hasWorkspaceAccess: boolean
  canWriteWorkspace: boolean
  isAdmin: boolean
}

/**
 * Resolves user access context for a credential. Pass `workspaceAccess` when the
 * caller has already resolved access for the credential's workspace to skip a
 * redundant lookup; it is reused only when it matches the credential's workspace.
 */
export async function getCredentialActorContext(
  credentialId: string,
  userId: string,
  options?: { workspaceAccess?: WorkspaceAccess }
): Promise<CredentialActorContext> {
  const [credentialRow] = await db
    .select()
    .from(credential)
    .where(eq(credential.id, credentialId))
    .limit(1)

  if (!credentialRow) {
    return {
      credential: null,
      member: null,
      hasWorkspaceAccess: false,
      canWriteWorkspace: false,
      isAdmin: false,
    }
  }

  const providedAccess = options?.workspaceAccess
  const workspaceAccess =
    providedAccess && providedAccess.workspace?.id === credentialRow.workspaceId
      ? providedAccess
      : await checkWorkspaceAccess(credentialRow.workspaceId, userId)
  const [memberRow] = await db
    .select()
    .from(credentialMember)
    .where(
      and(
        eq(credentialMember.credentialId, credentialId),
        eq(credentialMember.userId, userId),
        eq(credentialMember.status, 'active')
      )
    )
    .limit(1)

  // Ownership remains authoritative if a personal credential's membership row is missing.
  const isPersonalOwner =
    credentialRow.type === 'env_personal' && credentialRow.envOwnerUserId === userId
  const isAdmin =
    isPersonalOwner ||
    deriveCredentialAdmin({
      credentialType: credentialRow.type,
      memberRole: memberRow?.role,
      workspaceCanAdmin: workspaceAccess.canAdmin,
    })

  return {
    credential: credentialRow,
    member: memberRow ?? null,
    hasWorkspaceAccess: workspaceAccess.hasAccess,
    canWriteWorkspace: workspaceAccess.canWrite,
    isAdmin,
  }
}

/**
 * Revokes all credential memberships for a user across one or more workspaces.
 * Workspace owners and admins are derived credential admins, so no per-credential
 * owner promotion is needed to avoid orphaning a credential. Returns the number
 * of memberships revoked.
 */
export async function revokeWorkspaceCredentialMembershipsTx(
  tx: DbOrTx,
  workspaceId: string | string[],
  userId: string
): Promise<number> {
  const workspaceIds = Array.isArray(workspaceId) ? workspaceId : [workspaceId]
  if (workspaceIds.length === 0) return 0

  const workspaceCredentialIds = await tx
    .select({ id: credential.id })
    .from(credential)
    .where(inArray(credential.workspaceId, workspaceIds))

  if (workspaceCredentialIds.length === 0) return 0

  const credIds = workspaceCredentialIds.map((c) => c.id)

  const revoked = await tx
    .update(credentialMember)
    .set({ status: 'revoked', updatedAt: new Date() })
    .where(
      and(
        eq(credentialMember.userId, userId),
        eq(credentialMember.status, 'active'),
        inArray(credentialMember.credentialId, credIds)
      )
    )
    .returning({ id: credentialMember.id })

  return revoked.length
}
