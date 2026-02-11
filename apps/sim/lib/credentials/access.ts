import { db } from '@sim/db'
import { credential, credentialMember } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
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

  const isAdmin = memberRow?.role === 'admin'

  return {
    credential: credentialRow,
    member: memberRow ?? null,
    hasWorkspaceAccess: workspaceAccess.hasAccess,
    canWriteWorkspace: workspaceAccess.canWrite,
    isAdmin,
  }
}
