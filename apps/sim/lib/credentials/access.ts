import { db } from '@sim/db'
import { credential, credentialMember } from '@sim/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

type ActiveCredentialMember = typeof credentialMember.$inferSelect
type CredentialRecord = typeof credential.$inferSelect

export interface CredentialActorContext {
  credential: CredentialRecord | null
  member: ActiveCredentialMember | null
  hasWorkspaceAccess: boolean
  canWriteWorkspace: boolean
  isAdmin: boolean
}

/**
 * Resolves user access context for a credential.
 */
export async function getCredentialActorContext(
  credentialId: string,
  userId: string
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

  const workspaceAccess = await checkWorkspaceAccess(credentialRow.workspaceId, userId)
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

  const isAdmin =
    memberRow?.role === 'admin' ||
    (credentialRow.type !== 'env_personal' && workspaceAccess.canAdmin)

  return {
    credential: credentialRow,
    member: memberRow ?? null,
    hasWorkspaceAccess: workspaceAccess.hasAccess,
    canWriteWorkspace: workspaceAccess.canWrite,
    isAdmin,
  }
}

/**
 * Revokes all credential memberships for a user across a workspace. Workspace
 * owners and admins are derived credential admins, so no per-credential owner
 * promotion is needed to avoid orphaning a credential.
 */
export async function revokeWorkspaceCredentialMemberships(
  workspaceId: string,
  userId: string
): Promise<void> {
  await revokeWorkspaceCredentialMembershipsTx(db, workspaceId, userId)
}

export async function revokeWorkspaceCredentialMembershipsTx(
  tx: DbOrTx,
  workspaceId: string,
  userId: string
): Promise<void> {
  const workspaceCredentialIds = await tx
    .select({ id: credential.id })
    .from(credential)
    .where(eq(credential.workspaceId, workspaceId))

  if (workspaceCredentialIds.length === 0) return

  const credIds = workspaceCredentialIds.map((c) => c.id)

  await tx
    .update(credentialMember)
    .set({ status: 'revoked', updatedAt: new Date() })
    .where(
      and(
        eq(credentialMember.userId, userId),
        eq(credentialMember.status, 'active'),
        inArray(credentialMember.credentialId, credIds)
      )
    )
}
