import { db } from '@sim/db'
import { credential, credentialMember, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CredentialAccess')

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

  const isAdmin = memberRow?.role === 'admin'

  return {
    credential: credentialRow,
    member: memberRow ?? null,
    hasWorkspaceAccess: workspaceAccess.hasAccess,
    canWriteWorkspace: workspaceAccess.canWrite,
    isAdmin,
  }
}

/**
 * Revokes all credential memberships for a user across a workspace.
 * Before revoking, ensures the workspace owner is an admin on any credential
 * where the removed user is the sole active admin, preventing orphaned credentials.
 */
export async function revokeWorkspaceCredentialMemberships(
  workspaceId: string,
  userId: string
): Promise<void> {
  const workspaceCredentialIds = await db
    .select({ id: credential.id })
    .from(credential)
    .where(eq(credential.workspaceId, workspaceId))

  if (workspaceCredentialIds.length === 0) return

  const credIds = workspaceCredentialIds.map((c) => c.id)

  const [workspaceRow] = await db
    .select({ ownerId: workspace.ownerId })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)

  const ownerId = workspaceRow?.ownerId

  if (ownerId && ownerId !== userId) {
    const userAdminMemberships = await db
      .select({ credentialId: credentialMember.credentialId })
      .from(credentialMember)
      .where(
        and(
          eq(credentialMember.userId, userId),
          eq(credentialMember.role, 'admin'),
          eq(credentialMember.status, 'active'),
          inArray(credentialMember.credentialId, credIds)
        )
      )

    for (const { credentialId: credId } of userAdminMemberships) {
      const otherAdmins = await db
        .select({ id: credentialMember.id })
        .from(credentialMember)
        .where(
          and(
            eq(credentialMember.credentialId, credId),
            eq(credentialMember.role, 'admin'),
            eq(credentialMember.status, 'active'),
            ne(credentialMember.userId, userId)
          )
        )
        .limit(1)

      if (otherAdmins.length > 0) continue

      const now = new Date()
      const [existingOwnerMembership] = await db
        .select({ id: credentialMember.id, status: credentialMember.status })
        .from(credentialMember)
        .where(and(eq(credentialMember.credentialId, credId), eq(credentialMember.userId, ownerId)))
        .limit(1)

      if (existingOwnerMembership) {
        await db
          .update(credentialMember)
          .set({ role: 'admin', status: 'active', updatedAt: now })
          .where(eq(credentialMember.id, existingOwnerMembership.id))
      } else {
        await db.insert(credentialMember).values({
          id: crypto.randomUUID(),
          credentialId: credId,
          userId: ownerId,
          role: 'admin',
          status: 'active',
          joinedAt: now,
          invitedBy: ownerId,
          createdAt: now,
          updatedAt: now,
        })
      }

      logger.info('Assigned workspace owner as credential admin before member removal', {
        credentialId: credId,
        ownerId,
        removedUserId: userId,
      })
    }
  }

  await db
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
