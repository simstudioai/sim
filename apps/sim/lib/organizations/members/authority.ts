import { member } from '@sim/db/schema'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, eq } from 'drizzle-orm'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import type { DbOrTx } from '@/lib/db/types'

/** Rechecks the acting member while the organization mutation lock is held. */
export async function requireMemberManagementAuthority(
  executor: DbOrTx,
  organizationId: string,
  actorUserId: string,
  selfRemovalUserId?: string
): Promise<void> {
  const [actor] = await executor
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, actorUserId)))
    .for('update')
    .limit(1)
  if (!actor || (!isOrgAdminRole(actor.role) && actorUserId !== selfRemovalUserId)) {
    throw new ForbiddenOperationError(
      'ORGANIZATION_ADMIN_REQUIRED',
      'Organization administrator access is required'
    )
  }
}
