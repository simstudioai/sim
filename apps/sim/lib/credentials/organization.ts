import { db } from '@sim/db'
import { credential, member } from '@sim/db/schema'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, eq } from 'drizzle-orm'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import type { CredentialCreationWorkspaceContext } from '@/lib/credentials/environment'
import type { DbOrTx } from '@/lib/db/types'

/** Current organization role is re-read under the same membership locks used by removal. */
export async function getCredentialCreationOrganizationContext(params: {
  executor: DbOrTx
  organizationId: string
  userId: string
  forUpdate?: boolean
}): Promise<CredentialCreationWorkspaceContext | null> {
  const query = params.executor
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, params.organizationId), eq(member.userId, params.userId)))
  const [membership] = params.forUpdate
    ? await query.for('no key update').limit(1)
    : await query.limit(1)
  if (!membership) return null
  return {
    organizationId: params.organizationId,
    ownerId: null,
    memberUserIds: [params.userId],
    canWrite: isOrgAdminRole(membership.role),
  }
}

/** Loads only the credential's asserted organization owner. */
export async function getOrganizationCredential(organizationId: string, credentialId: string) {
  const [row] = await db
    .select()
    .from(credential)
    .where(
      and(
        eq(credential.id, credentialId),
        resourceScopeCondition(credential, { kind: 'organization', organizationId })
      )
    )
    .limit(1)
  return row ?? null
}
